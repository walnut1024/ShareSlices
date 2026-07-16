import type { Pool } from "pg";

export type ProposalResolution = "pass" | "reject" | "governance_block";
export type ProposalContext = Readonly<{
  listingLifecycle: "pending" | "listed" | "withdrawn" | "removed";
  listingRevision: number;
  currentRevisionId: string | null;
  proposalBaseRevision: number;
  proposalState: string;
  governanceBlocked: boolean;
}>;

export type ProposalDecision =
  | Readonly<{kind: "promote"; initial: boolean}>
  | Readonly<{kind: "close_initial"; closureReason: "initial_policy_rejection" | "initial_governance_block"}>
  | Readonly<{kind: "close_update"; state: "rejected" | "governance_blocked"}>
  | Readonly<{kind: "stale" | "conflict"; reason: string}>;

export function decideProposalResolution(context: ProposalContext, resolution: ProposalResolution): ProposalDecision {
  if (context.proposalState !== "open") return {kind: "conflict", reason: "proposal_closed"};
  if (!(["pending", "listed"] as const).includes(context.listingLifecycle as "pending" | "listed")) return {kind: "conflict", reason: "listing_closed"};
  if (context.proposalBaseRevision !== context.listingRevision) return {kind: "stale", reason: "base_revision_mismatch"};
  const initial = context.currentRevisionId === null;
  if (context.governanceBlocked || resolution === "governance_block") return initial
    ? {kind: "close_initial", closureReason: "initial_governance_block"}
    : {kind: "close_update", state: "governance_blocked"};
  if (resolution === "reject") return initial
    ? {kind: "close_initial", closureReason: "initial_policy_rejection"}
    : {kind: "close_update", state: "rejected"};
  return {kind: "promote", initial};
}

export class PostgresGalleryProposalPromoter {
  constructor(private readonly pool: Pool) {}

  async resolve(proposalId: string, resolution: ProposalResolution): Promise<ProposalDecision> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(`select proposal.*, listing.lifecycle_state,
        listing.listing_revision, listing.current_revision_id, listing.artifact_id,
        exists(select 1 from gallery_public_sharing_restriction where artifact_id = listing.artifact_id and state = 'active')
          or exists(select 1 from gallery_artifact_takedown where artifact_id = listing.artifact_id and state = 'active')
          or (listing.lifecycle_state = 'removed' and listing.closure_reason = 'administrator_removal')
          or exists(select 1 from gallery_appeal appeal join gallery_governance_decision decision on decision.id = appeal.decision_id
            join gallery_governance_case governance_case on governance_case.id = decision.case_id
            where governance_case.listing_id = listing.id and appeal.state = 'pending') as governance_blocked
        from gallery_listing_proposal proposal join gallery_listing listing on listing.id = proposal.listing_id
        where proposal.id = $1 for update of proposal, listing`, [proposalId]);
      const row = rows[0];
      if (!row) throw new Error("gallery_proposal_not_found");
      const decision = decideProposalResolution({listingLifecycle: row.lifecycle_state, listingRevision: Number(row.listing_revision), currentRevisionId: row.current_revision_id, proposalBaseRevision: Number(row.base_listing_revision), proposalState: row.state, governanceBlocked: row.governance_blocked}, resolution);
      if (decision.kind === "stale") await client.query("update gallery_listing_proposal set state = 'stale', closed_at = now() where id = $1", [proposalId]);
      if (decision.kind === "close_update") await client.query("update gallery_listing_proposal set state = $2, closed_at = now() where id = $1", [proposalId, decision.state]);
      if (decision.kind === "close_initial") {
        await client.query("update gallery_listing_proposal set state = $2, closed_at = now() where id = $1", [proposalId, decision.closureReason === "initial_policy_rejection" ? "rejected" : "governance_blocked"]);
        await client.query(`update gallery_listing set lifecycle_state = 'removed', closure_reason = $2,
          closed_at = now(), listing_revision = listing_revision + 1, updated_at = now() where id = $1`, [row.listing_id, decision.closureReason]);
      }
      if (decision.kind === "promote") {
        const revisionId = `grevision_${crypto.randomUUID()}`;
        const next = Number(row.listing_revision) + 1;
        await client.query(`insert into gallery_listing_revision
          (id, listing_id, revision, version_id, permission_acceptance_id, public_title, public_description, tags)
          values ($1, $2, $3, $4, $5, $6, $7, $8)`, [revisionId, row.listing_id, next, row.version_id, row.permission_acceptance_id, row.public_title, row.public_description, row.tags]);
        await client.query(`update gallery_listing set lifecycle_state = 'listed', closure_reason = null,
          current_revision_id = $2, listing_revision = $3, updated_at = now(), closed_at = null where id = $1`, [row.listing_id, revisionId, next]);
        if (decision.initial) await client.query(`update gallery_creator_profile profile set public_at = coalesce(public_at, now()), updated_at = now()
          from gallery_listing listing where listing.id = $1 and profile.id = listing.creator_profile_id`, [row.listing_id]);
        await client.query("update gallery_listing_proposal set state = 'promoted', closed_at = now() where id = $1", [proposalId]);
      }
      await client.query("commit");
      return decision;
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
}
