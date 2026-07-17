import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { galleryPermissionBundle, validateGalleryPermissionAcceptance, type GalleryPermissionAcceptanceInput, type GalleryPermissionGrantRecord } from "./permission-grant.js";
import { normalizeProfileFields, type GalleryProfileFields } from "./creator-profile.js";

export type GalleryCandidateMetadata = Readonly<{title: string; description: string | null; tags: readonly string[]}>;
export type GallerySafetyPolicySnapshot = Readonly<Record<string, unknown> & {policyRevision: string}>;
export type GalleryOwnerOutcome = Readonly<{
  operationId: string;
  operation: "share_to_gallery" | "update_gallery" | "withdraw_from_gallery";
  acceptedAt: string;
  status: "accepted" | "completed";
  artifactId: string;
  listingId: string;
  listingRevision: number;
  proposalId?: string;
  lifecycle: "pending" | "listed" | "withdrawn";
  recovered: boolean;
}>;

export class GalleryOwnerOperationError extends Error {
  constructor(readonly code: "no_current_gallery_grant" | "stale_gallery_grant" | "gallery_permission_bundle_fixed" | "artifact_not_found" | "version_not_ready" | "listing_not_found" | "listing_revision_conflict" | "listing_already_open" | "governance_blocked" | "idempotency_conflict" | "invalid_gallery_metadata" | "irreversible_replacement_confirmation_required") { super(code); }
}

type ShareInput = Readonly<{
  ownerUserId: string; artifactId: string; versionId: string; idempotencyKey: string;
  expectedListingRevision?: number; profile: GalleryProfileFields & {expectedRevision: number | null};
  permission: Omit<GalleryPermissionAcceptanceInput, "acceptanceId" | "userId" | "listingId" | "versionId">;
  metadata: GalleryCandidateMetadata; confirmedReplacement?: boolean;
}>;

export class GalleryOwnerOperations {
  constructor(private readonly pool: Pool, private readonly safetyPolicy: GallerySafetyPolicySnapshot, private readonly rendererRevision: string, private readonly objectLayoutRevision = "gallery-objects/v1") {}

  async view(ownerUserId: string, artifactId: string): Promise<Readonly<Record<string, unknown>> | null> {
    const {rows} = await this.pool.query(`select listing.*, proposal.id proposal_id, proposal.state proposal_state,
      permission_grant.version grant_version, permission_grant.exact_text grant_text, permission_grant.text_digest grant_text_digest,
      permission_grant.requires_renewal_on_next_proposal grant_requires_renewal
      from artifact left join gallery_listing listing on listing.artifact_id=artifact.id and listing.owner_user_id=artifact.owner_user_id
      left join gallery_listing_proposal proposal on proposal.listing_id=listing.id and proposal.state='open'
      left join gallery_permission_grant permission_grant on permission_grant.active
      where artifact.id=$2 and artifact.owner_user_id=$1 order by listing.created_at desc limit 1`, [ownerUserId, artifactId]);
    const row = rows[0];
    if (!row?.id) return null;
    const committed = row.current_revision_id
      ? (await this.pool.query("select * from gallery_listing_revision where id=$1", [row.current_revision_id])).rows[0]
      : null;
    const proposal = row.proposal_id
      ? (await this.pool.query("select * from gallery_listing_proposal where id=$1", [row.proposal_id])).rows[0]
      : null;
    const history = (await this.pool.query(
      "select grant_version,accepted_at from gallery_permission_grant_acceptance where listing_id=$1 order by accepted_at",
      [row.id],
    )).rows.map((acceptance) => ({
      grantVersion: String(acceptance.grant_version),
      acceptedAt: new Date(acceptance.accepted_at).toISOString(),
    }));
    const restrictions: string[] = [];
    if (row.lifecycle_state !== "listed") restrictions.push("not_listed");
    if (row.review_state === "restricted") restrictions.push("public_sharing_restricted");
    const allowedActions: string[] = [];
    if (row.lifecycle_state === "pending") allowedActions.push("withdraw_from_gallery");
    if (row.lifecycle_state === "listed") {
      allowedActions.push("withdraw_from_gallery");
      if (["clear", "reviewing"].includes(row.review_state)) allowedActions.push("update_gallery");
    }
    if (["withdrawn"].includes(row.lifecycle_state) ||
      (row.lifecycle_state === "removed" && row.review_state === "clear" &&
        ["initial_policy_rejection", "initial_governance_block"].includes(row.closure_reason))) {
      allowedActions.push("share_to_gallery");
    }
    if (row.lifecycle_state === "removed" && row.closure_reason === "administrator_removal") {
      if (row.review_state === "clear" && row.restoration_forfeited_at === null) allowedActions.push("create_replacement");
      else allowedActions.push("submit_appeal");
    }
    return {
      id: String(row.id),
      artifactId,
      lifecycle: row.lifecycle_state,
      reviewState: row.review_state,
      closureReason: row.closure_reason,
      revision: Number(row.listing_revision),
      committed: committed ? {
        revision: Number(committed.revision),
        versionId: String(committed.version_id),
        metadata: {title: committed.public_title, description: committed.public_description, tags: committed.tags},
        createdAt: new Date(committed.created_at).toISOString(),
      } : null,
      proposal: proposal ? {
        id: String(proposal.id),
        state: proposal.state,
        baseListingRevision: Number(proposal.base_listing_revision),
        versionId: String(proposal.version_id),
        metadata: {title: proposal.public_title, description: proposal.public_description, tags: proposal.tags},
      } : null,
      currentGrantEvidence: history.at(-1) ?? null,
      historicalGrantEvidence: history,
      effectiveAccess: {accessible: restrictions.length === 0, restrictions},
      allowedActions,
      publicUrl: row.lifecycle_state === "listed" ? `/gallery/${encodeURIComponent(row.opaque_slug)}` : null,
    };
  }

  async share(input: ShareInput): Promise<GalleryOwnerOutcome> { return this.propose("share_to_gallery", input); }
  async update(input: ShareInput & Readonly<{expectedListingRevision: number}>): Promise<GalleryOwnerOutcome> { return this.propose("update_gallery", input); }
  async updateListing(input: Omit<ShareInput,"artifactId"> & Readonly<{listingId:string;expectedListingRevision:number}>):Promise<GalleryOwnerOutcome>{const {rows}=await this.pool.query("select artifact_id from gallery_listing where id=$1 and owner_user_id=$2",[input.listingId,input.ownerUserId]);if(!rows[0])throw new GalleryOwnerOperationError("listing_not_found");return this.update({...input,artifactId:String(rows[0].artifact_id)});}

  async withdraw(input: Readonly<{ownerUserId: string; listingId: string; expectedListingRevision: number; idempotencyKey: string}>): Promise<GalleryOwnerOutcome> {
    const fingerprint = digestJson({listingId: input.listingId, expectedListingRevision: input.expectedListingRevision});
    return this.transaction(async (client) => {
      const recovered = await recover(client, input.ownerUserId, "withdraw_from_gallery", input.idempotencyKey, fingerprint);
      if (recovered) return recovered;
      const {rows} = await client.query("select * from gallery_listing where id=$1 and owner_user_id=$2 for update", [input.listingId, input.ownerUserId]);
      const listing = rows[0];
      if (!listing) throw new GalleryOwnerOperationError("listing_not_found");
      if (Number(listing.listing_revision) !== input.expectedListingRevision) throw new GalleryOwnerOperationError("listing_revision_conflict");
      if (!(["pending", "listed"] as const).includes(listing.lifecycle_state)) throw new GalleryOwnerOperationError("listing_revision_conflict");
      const next = Number(listing.listing_revision) + 1;
      await client.query("update gallery_listing set lifecycle_state='withdrawn', closure_reason='creator_withdrawal', listing_revision=$2, closed_at=now(), updated_at=now() where id=$1", [input.listingId, next]);
      await client.query("update gallery_listing_proposal set state='closed', closed_at=now() where listing_id=$1 and state='open'", [input.listingId]);
      await client.query(`insert into gallery_listing_closure_tombstone(listing_id,opaque_slug,was_ever_public,terminal_lifecycle_state,closure_reason,permanently_non_restorable_at)
        values($1,$2,$3,'withdrawn','creator_withdrawal',now()) on conflict(listing_id) do nothing`, [input.listingId, listing.opaque_slug, listing.current_revision_id !== null]);
      await lifecycleEvent(client, listing, "withdrawn", "creator_withdrawal", next, input.ownerUserId);
      const outcome: GalleryOwnerOutcome = {
        operationId: operationId(),
        operation: "withdraw_from_gallery",
        acceptedAt: new Date().toISOString(),
        status: "completed",
        artifactId: String(listing.artifact_id),
        listingId: input.listingId,
        listingRevision: next,
        lifecycle: "withdrawn",
        recovered: false,
      };
      await saveOperation(client, outcome.operationId, input.ownerUserId, "withdraw_from_gallery", null, input.listingId, input.idempotencyKey, fingerprint, outcome);
      return outcome;
    });
  }

  private async propose(operation: "share_to_gallery" | "update_gallery", input: ShareInput): Promise<GalleryOwnerOutcome> {
    const metadata = normalizeMetadata(input.metadata);
    const fingerprint = digestJson({...input, idempotencyKey: undefined, metadata});
    return this.transaction(async (client) => {
      const recovered = await recover(client, input.ownerUserId, operation, input.idempotencyKey, fingerprint);
      if (recovered) return recovered;

      const grant = await currentGrant(client);
      try { validateGalleryPermissionAcceptance(grant, {...input.permission, acceptanceId: "pending", userId: input.ownerUserId, listingId: "pending", versionId: input.versionId}); }
      catch (error) { throw new GalleryOwnerOperationError((error as {code: GalleryOwnerOperationError["code"]}).code); }
      if (!grant || createHash("sha256").update(grant.exactText).digest("hex") !== grant.textDigest) throw new GalleryOwnerOperationError("no_current_gallery_grant");

      const version = (await client.query(`select version.id, version.artifact_id from artifact_version version join artifact on artifact.id=version.artifact_id
        where version.id=$1 and version.artifact_id=$2 and artifact.owner_user_id=$3 and version.state='ready' for share`, [input.versionId, input.artifactId, input.ownerUserId])).rows[0];
      if (!version) {
        const owns = (await client.query("select 1 from artifact where id=$1 and owner_user_id=$2", [input.artifactId, input.ownerUserId])).rowCount === 1;
        throw new GalleryOwnerOperationError(owns ? "version_not_ready" : "artifact_not_found");
      }
      const blocked = (await client.query(`select exists(select 1 from gallery_public_sharing_restriction where artifact_id=$1 and state='active')
        or exists(select 1 from gallery_artifact_takedown where artifact_id=$1 and state='active') blocked`, [input.artifactId])).rows[0]?.blocked === true;
      if (blocked) throw new GalleryOwnerOperationError("governance_blocked");

      const profile = await stageProfile(client, input.ownerUserId, input.profile);
      const prior = (await client.query("select * from gallery_listing where artifact_id=$1 order by created_at desc for update", [input.artifactId])).rows[0];
      let listingId: string;
      let listingRevision: number;
      if (operation === "update_gallery") {
        if (!prior || prior.owner_user_id !== input.ownerUserId) throw new GalleryOwnerOperationError("listing_not_found");
        if (prior.lifecycle_state !== "listed" || Number(prior.listing_revision) !== input.expectedListingRevision) throw new GalleryOwnerOperationError("listing_revision_conflict");
        listingId = prior.id; listingRevision = Number(prior.listing_revision);
      } else {
        if (prior && (["pending", "listed"] as const).includes(prior.lifecycle_state)) throw new GalleryOwnerOperationError("listing_already_open");
        if (prior?.closure_reason === "administrator_removal" && prior.restoration_forfeited_at === null && !input.confirmedReplacement) throw new GalleryOwnerOperationError("irreversible_replacement_confirmation_required");
        listingId = `glisting_${randomUUID()}`; listingRevision = 1;
        await client.query(`insert into gallery_listing(id,artifact_id,owner_user_id,creator_profile_id,opaque_slug,predecessor_listing_id)
          values($1,$2,$3,$4,$5,$6)`, [listingId, input.artifactId, input.ownerUserId, profile.id, opaque(32), prior?.id ?? null]);
        await client.query("insert into gallery_listing_engagement(listing_id) values($1)", [listingId]);
        await lifecycleEvent(client, null, "pending", null, listingRevision, input.ownerUserId, listingId);
        if (prior?.closure_reason === "administrator_removal" && prior.restoration_forfeited_at === null) await client.query("update gallery_listing set restoration_forfeited_at=now() where id=$1", [prior.id]);
      }

      const acceptanceId = `gaccept_${randomUUID()}`;
      await client.query(`insert into gallery_permission_grant_acceptance(id,user_id,listing_id,version_id,grant_version,grant_text_digest)
        values($1,$2,$3,$4,$5,$6)`, [acceptanceId, input.ownerUserId, listingId, input.versionId, grant.version, grant.textDigest]);
      const proposalId = `gproposal_${randomUUID()}`;
      await client.query(`insert into gallery_listing_proposal(id,listing_id,base_listing_revision,version_id,permission_acceptance_id,public_title,public_description,tags)
        values($1,$2,$3,$4,$5,$6,$7,$8)`, [proposalId, listingId, listingRevision, input.versionId, acceptanceId, metadata.title, metadata.description, metadata.tags]);
      const coverId=`gcover_${randomUUID()}`;
      const cover=(await client.query(`insert into gallery_cover(id,version_id,renderer_revision) values($1,$2,$3)
        on conflict(version_id,renderer_revision) do update set version_id=excluded.version_id returning id`, [coverId, input.versionId, this.rendererRevision])).rows[0];
      await client.query(`insert into gallery_cover_job(id,cover_id,version_id,contract_version,renderer_revision,object_layout_revision)
        values($1,$2,$3,'gallery-job/v1',$4,$5) on conflict(cover_id) do nothing`,[`gcoverjob_${randomUUID()}`,cover.id,input.versionId,this.rendererRevision,this.objectLayoutRevision]);
      const snapshotDigest = digestJson({proposalId, listingId, listingRevision, versionId: input.versionId, policy: this.safetyPolicy, objectLayoutRevision: this.objectLayoutRevision});
      await client.query(`insert into gallery_safety_job(id,proposal_id,version_id,contract_version,policy_revision,policy_snapshot,input_snapshot_digest,object_layout_revision)
        values($1,$2,$3,'gallery-job/v1',$4,$5,$6,$7)`, [`gsafety_${randomUUID()}`, proposalId, input.versionId, this.safetyPolicy.policyRevision, this.safetyPolicy, snapshotDigest, this.objectLayoutRevision]);
      const outcome: GalleryOwnerOutcome = {
        operationId: operationId(),
        operation,
        acceptedAt: new Date().toISOString(),
        status: "accepted",
        artifactId: input.artifactId,
        listingId,
        listingRevision,
        proposalId,
        lifecycle: operation === "update_gallery" ? "listed" : "pending",
        recovered: false,
      };
      await saveOperation(client, outcome.operationId, input.ownerUserId, operation, input.artifactId, operation === "update_gallery" ? listingId : null, input.idempotencyKey, fingerprint, outcome);
      return outcome;
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> { const client = await this.pool.connect(); try { await client.query("begin"); const value = await work(client); await client.query("commit"); return value; } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } }
}

function normalizeMetadata(input: GalleryCandidateMetadata): GalleryCandidateMetadata { const title=input.title.trim(); const description=input.description?.trim()||null; const tags=[...new Set(input.tags.map((tag)=>tag.trim().toLocaleLowerCase("en-US")))]; if(!title||title.length>200||(description?.length??0)>2000||tags.length>5||tags.some((tag)=>!tag||tag.length>40)) throw new GalleryOwnerOperationError("invalid_gallery_metadata"); return {title,description,tags}; }
async function currentGrant(client: PoolClient): Promise<GalleryPermissionGrantRecord | null> { const row=(await client.query("select * from gallery_permission_grant where active for share")).rows[0]; return row?{version:row.version,exactText:row.exact_text,textDigest:row.text_digest,permissions:galleryPermissionBundle,requiresRenewalOnNextProposal:row.requires_renewal_on_next_proposal}:null; }
async function stageProfile(client: PoolClient,userId:string,input:GalleryProfileFields&{expectedRevision:number|null}) { const fields=normalizeProfileFields(input); await client.query('select id from "user" where id=$1 for update',[userId]); const existing=(await client.query("select * from gallery_creator_profile where user_id=$1 for update",[userId])).rows[0]; if(existing){const same=existing.display_name===fields.displayName&&existing.biography===fields.biography; if(input.expectedRevision===null||Number(existing.revision)!==input.expectedRevision) throw new Error("profile_revision_conflict"); if(same)return existing; return (await client.query(`update gallery_creator_profile set display_name=$2,biography=$3,revision=revision+1,updated_at=now() where id=$1 returning *`,[existing.id,fields.displayName,fields.biography])).rows[0];} if(input.expectedRevision!==null) throw new Error("profile_revision_conflict"); return (await client.query(`insert into gallery_creator_profile(id,user_id,opaque_slug,display_name,biography) values($1,$2,$3,$4,$5) returning *`,[`gprofile_${randomUUID()}`,userId,opaque(16),fields.displayName,fields.biography])).rows[0]; }
async function recover(client:PoolClient,userId:string,operation:string,key:string,fingerprint:string):Promise<GalleryOwnerOutcome|null>{const digest=digestText(key);const row=(await client.query("select input_fingerprint,historical_outcome from gallery_owner_operation where owner_user_id=$1 and operation=$2 and idempotency_key_digest=$3",[userId,operation,digest])).rows[0];if(!row)return null;if(row.input_fingerprint!==fingerprint)throw new GalleryOwnerOperationError("idempotency_conflict");return {...row.historical_outcome,recovered:true};}
async function saveOperation(client:PoolClient,id:string,userId:string,operation:string,artifactId:string|null,listingId:string|null,key:string,fingerprint:string,outcome:GalleryOwnerOutcome){await client.query(`insert into gallery_owner_operation(id,owner_user_id,operation,target_artifact_id,target_listing_id,idempotency_key_digest,input_fingerprint,state,historical_outcome,completed_at) values($1,$2,$3,$4,$5,$6,$7,'completed',$8,now())`,[id,userId,operation,artifactId,listingId,digestText(key),fingerprint,outcome]);}
async function lifecycleEvent(client:PoolClient,before:Record<string,unknown>|null,to:string,reason:string|null,revision:number,actorId:string,listingId?:string){await client.query(`insert into gallery_listing_lifecycle_event(id,listing_id,from_lifecycle_state,to_lifecycle_state,closure_reason,base_listing_revision,committed_listing_revision,actor_kind,actor_id) values($1,$2,$3,$4,$5,$6,$7,'creator',$8)`,[`glevent_${randomUUID()}`,listingId??before?.id,before?.lifecycle_state??null,to,reason,before?.listing_revision??null,revision,actorId]);}
function digestJson(value:unknown){return digestText(JSON.stringify(value));} function digestText(value:string){return createHash("sha256").update(value).digest("hex");} function opaque(length:number){return randomUUID().replaceAll("-","").slice(0,length);} function operationId(){return `goperation_${randomUUID()}`;}
