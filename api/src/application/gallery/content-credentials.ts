import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";

export type GalleryContentBinding = Readonly<{kind: "public" | "review"; versionId: string; listingId?: string; listingRevision?: number; caseId?: string; proposalId?: string}>;

const token = () => randomBytes(32).toString("base64url");
const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

export class GalleryContentCredentialService {
  constructor(private readonly pool: Pool, private readonly lifetimeSeconds = 300) {}

  async issuePublic(opaqueSlug: string): Promise<Readonly<{credential: string; expiresAt: Date; entryUrlPath: string}> | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const {rows} = await client.query(`select listing.id,listing.listing_revision,revision.version_id
        from gallery_listing listing join gallery_listing_revision revision on revision.id=listing.current_revision_id
        where listing.opaque_slug=$1 and listing.lifecycle_state='listed' and listing.review_state in ('clear','reviewing')
        and not exists(select 1 from gallery_public_sharing_restriction restriction where restriction.artifact_id=listing.artifact_id and restriction.state='active')
        and not exists(select 1 from gallery_artifact_takedown takedown where takedown.artifact_id=listing.artifact_id and takedown.state='active') for share of listing`, [opaqueSlug]);
      const listing=rows[0]; if(!listing){await client.query("rollback");return null;}
      const credential=token(); const expiresAt=new Date(Date.now()+this.lifetimeSeconds*1000);
      await client.query("insert into gallery_player_credential(token_hash,listing_id,listing_revision,version_id,expires_at) values($1,$2,$3,$4,$5)",[tokenHash(credential),listing.id,listing.listing_revision,listing.version_id,expiresAt]);
      await client.query("insert into gallery_listing_engagement(listing_id,view_count) values($1,1) on conflict(listing_id) do update set view_count=gallery_listing_engagement.view_count+1,updated_at=now()",[listing.id]);
      await client.query("commit"); return {credential,expiresAt,entryUrlPath:`/gallery-content/public/${credential}/`};
    } catch(error){await client.query("rollback");throw error;} finally{client.release();}
  }

  async issueReview(administratorUserId:string,input:Readonly<{caseId?:string;proposalId?:string}>):Promise<Readonly<{credential:string;expiresAt:Date;entryUrlPath:string}>|null>{
    if(Boolean(input.caseId)===Boolean(input.proposalId)) throw new Error("invalid_review_subject");
    const {rows}=await this.pool.query(`select coalesce(case_proposal.version_id,direct_proposal.version_id,current_revision.version_id) version_id
      from gallery_administrator_authority authority
      left join gallery_governance_case governance_case on governance_case.id=$2 and governance_case.state='open'
      left join gallery_listing_proposal case_proposal on case_proposal.id=governance_case.proposal_id
      left join gallery_listing case_listing on case_listing.id=governance_case.listing_id
      left join gallery_listing_revision current_revision on current_revision.id=case_listing.current_revision_id
      left join gallery_listing_proposal direct_proposal on direct_proposal.id=$3 and direct_proposal.state='open'
      where authority.user_id=$1 and authority.revoked_at is null and coalesce(case_proposal.version_id,direct_proposal.version_id,current_revision.version_id) is not null`,[administratorUserId,input.caseId??null,input.proposalId??null]);
    const row=rows[0];if(!row)return null;const credential=token();const expiresAt=new Date(Date.now()+this.lifetimeSeconds*1000);
    await this.pool.query("insert into gallery_review_credential(token_hash,administrator_user_id,case_id,proposal_id,version_id,expires_at) values($1,$2,$3,$4,$5,$6)",[tokenHash(credential),administratorUserId,input.caseId??null,input.proposalId??null,row.version_id,expiresAt]);
    return {credential,expiresAt,entryUrlPath:`/gallery-content/review/${credential}/`};
  }
}

export class PostgresPublicPlayerCredentialValidator {
  constructor(private readonly pool:Pool,private readonly liveEligible:()=>boolean|Promise<boolean>){ }
  async validate(credential:string):Promise<GalleryContentBinding|null>{if(!await this.liveEligible())return null;const {rows}=await this.pool.query(`select token.version_id,token.listing_id,token.listing_revision from gallery_player_credential token
    join gallery_listing listing on listing.id=token.listing_id and listing.lifecycle_state='listed' and listing.review_state in ('clear','reviewing')
    join gallery_listing_revision revision on revision.listing_id=listing.id and revision.revision=token.listing_revision and revision.version_id=token.version_id
    where token.token_hash=$1 and token.revoked_at is null and token.expires_at>now()
    and not exists(select 1 from gallery_public_sharing_restriction restriction where restriction.artifact_id=listing.artifact_id and restriction.state='active')
    and not exists(select 1 from gallery_artifact_takedown takedown where takedown.artifact_id=listing.artifact_id and takedown.state='active')`,[tokenHash(credential)]);const row=rows[0];return row?{kind:"public",versionId:row.version_id,listingId:row.listing_id,listingRevision:Number(row.listing_revision)}:null;}
}

export class PostgresAdministratorReviewCredentialValidator {
  constructor(private readonly pool:Pool){ }
  async validate(credential:string):Promise<GalleryContentBinding|null>{const {rows}=await this.pool.query(`select token.version_id,token.case_id,token.proposal_id from gallery_review_credential token
    join gallery_administrator_authority authority on authority.user_id=token.administrator_user_id and authority.revoked_at is null
    left join gallery_governance_case governance_case on governance_case.id=token.case_id and governance_case.state='open'
    left join gallery_listing_proposal proposal on proposal.id=token.proposal_id and proposal.state='open'
    where token.token_hash=$1 and token.revoked_at is null and token.expires_at>now() and (governance_case.id is not null or proposal.id is not null)`,[tokenHash(credential)]);const row=rows[0];return row?{kind:"review",versionId:row.version_id,caseId:row.case_id??undefined,proposalId:row.proposal_id??undefined}:null;}
}
