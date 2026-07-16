import type { Pool, PoolClient } from "pg";
import type { GalleryClosureReason, GalleryLifecycle, GalleryReviewState } from "./domain.js";

export type GalleryListingState = Readonly<{
  id: string;
  lifecycle: GalleryLifecycle;
  reviewState: GalleryReviewState;
  closureReason: GalleryClosureReason | null;
  listingRevision: number;
  hasCommittedRevision: boolean;
  restorationForfeited: boolean;
}>;

export type GalleryTransitionCommand =
  | Readonly<{kind: "promote_initial"}>
  | Readonly<{kind: "creator_withdrawal"}>
  | Readonly<{kind: "initial_policy_rejection"}>
  | Readonly<{kind: "initial_governance_block"}>
  | Readonly<{kind: "administrator_removal"}>
  | Readonly<{kind: "administrator_restoration"}>
  | Readonly<{kind: "artifact_deleted" | "account_deleted"}>
  | Readonly<{kind: "begin_review" | "clear_review" | "restrict"}>;

export type GalleryTransitionDecision =
  | Readonly<{kind: "commit"; lifecycle: GalleryLifecycle; reviewState: GalleryReviewState; closureReason: GalleryClosureReason | null; closeProposals: boolean}>
  | Readonly<{kind: "preserve_terminal_with_source_event"}>
  | Readonly<{kind: "conflict"; reason: string}>;

export function decideGalleryTransition(state: GalleryListingState, command: GalleryTransitionCommand): GalleryTransitionDecision {
  if (command.kind === "begin_review") return state.lifecycle === "pending" || state.lifecycle === "listed"
    ? {kind: "commit", lifecycle: state.lifecycle, reviewState: "reviewing", closureReason: state.closureReason, closeProposals: false}
    : {kind: "conflict", reason: "terminal_listing"};
  if (command.kind === "clear_review") return state.lifecycle === "pending" || state.lifecycle === "listed"
    ? {kind: "commit", lifecycle: state.lifecycle, reviewState: "clear", closureReason: state.closureReason, closeProposals: false}
    : {kind: "conflict", reason: "terminal_listing"};
  if (command.kind === "restrict") return state.lifecycle === "pending" || state.lifecycle === "listed"
    ? {kind: "commit", lifecycle: state.lifecycle, reviewState: "restricted", closureReason: state.closureReason, closeProposals: true}
    : {kind: "conflict", reason: "terminal_listing"};
  if (command.kind === "promote_initial") return state.lifecycle === "pending" && !state.hasCommittedRevision
    ? {kind: "commit", lifecycle: "listed", reviewState: "clear", closureReason: null, closeProposals: true}
    : {kind: "conflict", reason: "initial_promotion_not_allowed"};
  if (command.kind === "creator_withdrawal") return state.lifecycle === "pending" || state.lifecycle === "listed"
    ? {kind: "commit", lifecycle: "withdrawn", reviewState: state.reviewState, closureReason: "creator_withdrawal", closeProposals: true}
    : {kind: "conflict", reason: "withdrawal_not_allowed"};
  if (command.kind === "initial_policy_rejection" || command.kind === "initial_governance_block") {
    if (state.lifecycle !== "pending" || state.hasCommittedRevision) return {kind: "conflict", reason: "initial_closure_not_allowed"};
    return {kind: "commit", lifecycle: "removed", reviewState: state.reviewState, closureReason: command.kind, closeProposals: true};
  }
  if (command.kind === "administrator_removal") return state.lifecycle === "listed" && state.hasCommittedRevision
    ? {kind: "commit", lifecycle: "removed", reviewState: state.reviewState, closureReason: "administrator_removal", closeProposals: true}
    : {kind: "conflict", reason: "administrator_removal_not_allowed"};
  if (command.kind === "administrator_restoration") return state.lifecycle === "removed" && state.closureReason === "administrator_removal" && state.hasCommittedRevision && !state.restorationForfeited
    ? {kind: "commit", lifecycle: "listed", reviewState: "clear", closureReason: null, closeProposals: true}
    : {kind: "conflict", reason: "restoration_not_allowed"};
  if (state.lifecycle === "removed" && state.closureReason !== "administrator_removal") return {kind: "preserve_terminal_with_source_event"};
  if (state.lifecycle === "withdrawn") return {kind: "preserve_terminal_with_source_event"};
  return {kind: "commit", lifecycle: "withdrawn", reviewState: state.reviewState, closureReason: command.kind, closeProposals: true};
}

export type PersistedGalleryTransition =
  | Readonly<{kind: "committed"; state: GalleryListingState}>
  | Readonly<{kind: "current_state"; state: GalleryListingState; reason: string}>;

export class PostgresGalleryTransitionStore {
  constructor(private readonly pool: Pool) {}

  async transition(listingId: string, expectedRevision: number, command: GalleryTransitionCommand, actor: Readonly<{kind: "creator" | "administrator" | "system"; id: string | null}>): Promise<PersistedGalleryTransition> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await this.loadForUpdate(client, listingId);
      if (!current) throw new Error("gallery_listing_not_found");
      if (current.listingRevision !== expectedRevision) { await client.query("commit"); return {kind: "current_state", state: current, reason: "revision_conflict"}; }
      const decision = decideGalleryTransition(current, command);
      if (decision.kind === "conflict") { await client.query("commit"); return {kind: "current_state", state: current, reason: decision.reason}; }
      if (decision.kind === "preserve_terminal_with_source_event") {
        await this.recordEvent(client, current, current, command.kind, actor);
        await client.query("commit");
        return {kind: "current_state", state: current, reason: "terminal_state_preserved"};
      }
      const nextRevision = current.listingRevision + 1;
      const closedAt = decision.lifecycle === "removed" || decision.lifecycle === "withdrawn" ? new Date() : null;
      await client.query(`update gallery_listing set lifecycle_state = $2, review_state = $3,
        closure_reason = $4, listing_revision = $5, closed_at = $6, updated_at = now()
        where id = $1`, [listingId, decision.lifecycle, decision.reviewState, decision.closureReason, nextRevision, closedAt]);
      if (decision.closeProposals) await client.query("update gallery_listing_proposal set state = 'closed', closed_at = now() where listing_id = $1 and state = 'open'", [listingId]);
      const next: GalleryListingState = {...current, lifecycle: decision.lifecycle, reviewState: decision.reviewState, closureReason: decision.closureReason, listingRevision: nextRevision};
      await this.recordEvent(client, current, next, command.kind, actor);
      await client.query("commit");
      return {kind: "committed", state: next};
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }

  private async loadForUpdate(client: PoolClient, listingId: string): Promise<GalleryListingState | null> {
    const { rows } = await client.query(`select lifecycle_state, review_state, closure_reason,
      listing_revision, current_revision_id, restoration_forfeited_at from gallery_listing where id = $1 for update`, [listingId]);
    const row = rows[0];
    return row ? {id: listingId, lifecycle: row.lifecycle_state, reviewState: row.review_state, closureReason: row.closure_reason, listingRevision: Number(row.listing_revision), hasCommittedRevision: row.current_revision_id !== null, restorationForfeited: row.restoration_forfeited_at !== null} : null;
  }

  private async recordEvent(client: PoolClient, before: GalleryListingState, after: GalleryListingState, event: string, actor: Readonly<{kind: string; id: string | null}>): Promise<void> {
    await client.query(`insert into gallery_listing_lifecycle_event
      (id, listing_id, from_lifecycle_state, to_lifecycle_state, closure_reason,
       base_listing_revision, committed_listing_revision, actor_kind, actor_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [`glevent_${crypto.randomUUID()}`, before.id, before.lifecycle, after.lifecycle, after.closureReason ?? (event.endsWith("deleted") ? event : null), before.listingRevision, after.listingRevision, actor.kind, actor.id]);
  }
}
