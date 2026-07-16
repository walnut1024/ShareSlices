export type GalleryLifecycle = "pending" | "listed" | "withdrawn" | "removed";
export type GalleryReviewState = "clear" | "reviewing" | "restricted";
export type GalleryClosureReason =
  | "creator_withdrawal"
  | "artifact_deleted"
  | "account_deleted"
  | "initial_policy_rejection"
  | "initial_governance_block"
  | "administrator_removal";

export type GalleryEffectiveAccessRestriction =
  | "gallery_disabled"
  | "deployment_ineligible"
  | "not_listed"
  | "public_sharing_restricted"
  | "artifact_takedown"
  | "administrator_removal"
  | "appeal_pending"
  | "source_deleted";

export type GalleryEffectiveAccess = Readonly<{
  accessible: boolean;
  restrictions: readonly GalleryEffectiveAccessRestriction[];
}>;

export type GalleryCommittedRevision = Readonly<{
  id: string;
  revision: number;
  versionId: string;
  title: string;
  description: string | null;
  tags: readonly string[];
  permissionAcceptanceId: string;
}>;

export type GalleryProposal = Readonly<{
  id: string;
  baseListingRevision: number;
  versionId: string;
  state: "open" | "promoted" | "rejected" | "governance_blocked" | "stale" | "closed";
}>;

export type GalleryListingProjection = Readonly<{
  id: string;
  artifactId: string;
  lifecycle: GalleryLifecycle;
  reviewState: GalleryReviewState;
  closureReason: GalleryClosureReason | null;
  listingRevision: number;
  committed: GalleryCommittedRevision | null;
  proposal: GalleryProposal | null;
  effectiveAccess: GalleryEffectiveAccess;
}>;

export type GalleryTransitionResult =
  | Readonly<{ kind: "committed"; listing: GalleryListingProjection; historicalOperationId: string }>
  | Readonly<{ kind: "already_accepted"; historical: GalleryOperationOutcome; current: GalleryListingProjection }>
  | Readonly<{ kind: "revision_conflict"; current: GalleryListingProjection }>
  | Readonly<{ kind: "state_conflict"; current: GalleryListingProjection; reason: string }>
  | Readonly<{ kind: "forbidden" | "not_found" | "unavailable"; reason: string }>;

export type GalleryOperationOutcome = Readonly<{
  operationId: string;
  operation: "share_to_gallery" | "update_gallery" | "withdraw_from_gallery";
  acceptedAt: Date;
  status: "accepted" | "completed" | "rejected" | "indeterminate";
  committedListingRevision: number | null;
}>;

export type GalleryCopyState = "accepted" | "processing" | "ready" | "failed" | "cancelled" | "indeterminate";
export type GalleryCopyProjection = Readonly<{
  id: string;
  state: GalleryCopyState;
  sourceListingId: string;
  sourceListingRevision: number;
  sourceVersionId: string;
  destinationArtifactId: string | null;
  quotaState: "held" | "committed" | "released";
}>;

export type GalleryGovernanceProjection = Readonly<{
  caseId: string;
  caseKind: "proposal" | "report" | "removal" | "restriction" | "takedown" | "appeal";
  state: "open" | "decided" | "moot";
  effectiveAccess: GalleryEffectiveAccess;
}>;
