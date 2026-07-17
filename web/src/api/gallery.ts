export type GalleryCard = {
  slug: string;
  title: string;
  description: string | null;
  tags: string[];
  createdAt: string;
  creator: { slug: string; displayName: string };
  cover: { state: "placeholder" | "ready"; url: string | null };
};

export type GalleryPageResult = {
  items: GalleryCard[];
  nextCursor: string | null;
};
export type GalleryListing = GalleryCard & {
  sourceAttribution: {
    originalCreator: { slug: string; displayName: string } | null;
  } | null;
};
export type GalleryCreator = {
  profile: {
    slug: string;
    displayName: string;
    biography: string | null;
    avatarUrl: string | null;
  };
  listings: GalleryPageResult;
};
export type GalleryCopyOperation = {
  id: string;
  state: "accepted" | "processing" | "ready" | "failed" | "cancelled" | "indeterminate";
  sourceListingId: string;
  sourceListingRevision: number;
  sourceVersionId: string;
  destinationArtifactId: string | null;
  quotaState: "held" | "committed" | "released";
};
export type GalleryGrant = {
  version: string;
  exactText: string;
  textDigest: string;
  permissions: ["view", "gallery_download", "save_a_copy"];
  requiresRenewalOnNextProposal: boolean;
};
export type GalleryProfile = {
  id: string;
  opaqueSlug: string;
  displayName: string;
  biography: string | null;
  avatar: { url: string; width: number; height: number } | null;
  revision: number;
};
export type OwnerGalleryListing = {
  id: string;
  artifactId: string;
  lifecycle: "pending" | "listed" | "withdrawn" | "removed";
  reviewState: "clear" | "reviewing" | "restricted";
  closureReason: string | null;
  listingRevision: number;
  proposalId: string | null;
  proposalState: string | null;
  effectiveAccess: { accessible: boolean; restrictions: string[] };
  publicUrl: string | null;
  allowedActions: string[];
};

export type GalleryListingOperationResponse = {
  historicalOutcome: Record<string, unknown>;
  current: OwnerGalleryListing;
};

export class GalleryApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new GalleryApiError(
      body?.error?.message ?? "Gallery request failed.",
      body?.error?.code ?? "gallery_request_failed",
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function listGallery(input: {
  mode: "default" | "newest" | "featured" | "search" | "tag";
  query?: string;
  cursor?: string;
  limit?: number;
}): Promise<GalleryPageResult> {
  const base =
    input.mode === "default"
      ? "/gallery"
      : input.mode === "tag"
        ? `/gallery/tags/${encodeURIComponent(input.query ?? "")}`
        : input.mode === "search"
          ? "/gallery/search"
          : `/gallery/${input.mode}`;
  const query = new URLSearchParams();
  if (input.mode === "search" && input.query) query.set("q", input.query);
  if (input.cursor) query.set("cursor", input.cursor);
  query.set("limit", String(input.limit ?? 24));
  return request(`${base}?${query}`);
}

export function getGalleryListing(slug: string): Promise<GalleryListing> {
  return request(`/gallery/${encodeURIComponent(slug)}`);
}

export function getGalleryCreator(
  slug: string,
  cursor?: string,
): Promise<GalleryCreator> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request(`/gallery/creators/${encodeURIComponent(slug)}${query}`);
}

export function issueGalleryPlayer(slug: string): Promise<{
  expiresAt: string;
  entryUrl: string;
}> {
  return request(`/gallery/${encodeURIComponent(slug)}/player-authorizations`, {
    method: "POST",
  });
}

export function galleryDownloadUrl(slug: string): string {
  return `/gallery/${encodeURIComponent(slug)}/download`;
}

export function startGalleryCopy(
  slug: string,
  title: string,
  idempotencyKey: string,
) {
  return request<GalleryCopyOperation>(
    `/api/gallery/${encodeURIComponent(slug)}/copy-operations`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ title }),
    },
  );
}

export function getGalleryCopy(operationId: string) {
  return request<GalleryCopyOperation>(
    `/api/gallery-copy-operations/${encodeURIComponent(operationId)}`,
  );
}

export function submitGalleryReport(
  slug: string,
  input: { category: string; details: string; challengeToken?: string },
) {
  return request<{ accepted: true }>(
    `/gallery/${encodeURIComponent(slug)}/reports`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export async function getCurrentGalleryGrant(): Promise<GalleryGrant | null> {
  const result = await request<{ grant: GalleryGrant | null }>(
    "/api/gallery/permission-grant",
  );
  return result.grant;
}

export async function getOwnGalleryProfile(): Promise<GalleryProfile | null> {
  const result = await request<{ profile: GalleryProfile | null }>(
    "/api/gallery/profile",
  );
  return result.profile;
}

export async function updateOwnGalleryProfile(input: {
  displayName: string;
  biography: string | null;
  expectedRevision: number;
  avatarUploadId?: string | null;
}) {
  const result = await request<{ profile: GalleryProfile }>(
    "/api/gallery/profile",
    {
      method: "PATCH",
      headers: { "content-type": "application/json", "If-Match": `"${input.expectedRevision}"` },
      body: JSON.stringify({...input, expectedRevision: undefined}),
    },
  );
  return result.profile;
}

export async function uploadGalleryAvatar(file: File) {
  const form = new FormData();
  form.set("file", file);
  return request<{ avatarUploadId: string; width: number; height: number }>(
    "/api/gallery/profile/avatar-uploads",
    { method: "POST", body: form },
  );
}

export async function getOwnerGalleryListing(
  artifactId: string,
): Promise<OwnerGalleryListing | null> {
  const result = await request<{
    listing?: Record<string, unknown> | null;
    gallery?: Record<string, unknown> | null;
  }>(
    `/api/artifacts/${encodeURIComponent(artifactId)}/gallery-listing`,
  );
  const row = result.listing ?? result.gallery;
  if (!row || !row.id) return null;
  return ownerGalleryListing(row);
}

function ownerGalleryListing(row: Record<string, unknown>): OwnerGalleryListing {
  return {
    id: String(row.id),
    artifactId: String(row.artifactId ?? row.artifact_id),
    lifecycle: String(row.lifecycle ?? row.lifecycle_state) as OwnerGalleryListing["lifecycle"],
    reviewState: String(row.reviewState ?? row.review_state) as OwnerGalleryListing["reviewState"],
    closureReason: row.closureReason ? String(row.closureReason) : row.closure_reason ? String(row.closure_reason) : null,
    listingRevision: Number(row.revision ?? row.listing_revision),
    proposalId: typeof row.proposal === "object" && row.proposal ? String((row.proposal as Record<string, unknown>).id) : row.proposal_id ? String(row.proposal_id) : null,
    proposalState: typeof row.proposal === "object" && row.proposal ? String((row.proposal as Record<string, unknown>).state) : row.proposal_state ? String(row.proposal_state) : null,
    effectiveAccess: (row.effectiveAccess as OwnerGalleryListing["effectiveAccess"] | undefined) ?? {accessible: true, restrictions: []},
    publicUrl: row.publicUrl ? String(row.publicUrl) : row.public_url ? String(row.public_url) : null,
    allowedActions: Array.isArray(row.allowedActions) ? row.allowedActions.map(String) : [],
  };
}

export type GalleryShareInput = {
  versionId: string;
  profile: {
    displayName: string;
    biography: string | null;
    avatar: null;
    expectedRevision: number | null;
  };
  permission: { grantVersion: string; accepted: true };
  metadata: { title: string; description: string | null; tags: string[] };
  confirmedReplacement?: boolean;
};

export async function shareArtifactToGallery(
  artifactId: string,
  input: GalleryShareInput,
  idempotencyKey: string,
) : Promise<GalleryListingOperationResponse> {
  const result = await request<{
    historicalOutcome: Record<string, unknown>;
    current: Record<string, unknown>;
  }>(
    `/api/artifacts/${encodeURIComponent(artifactId)}/gallery-listing`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  return {
    historicalOutcome: result.historicalOutcome,
    current: ownerGalleryListing(result.current),
  };
}

export function updateArtifactGallery(
  listingId: string,
  input: GalleryShareInput,
  expectedRevision: number,
  idempotencyKey: string,
) {
  return request<{ outcome: Record<string, unknown> }>(
    `/api/gallery-listings/${encodeURIComponent(listingId)}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "If-Match": `\"${expectedRevision}\"`,
      },
      body: JSON.stringify(input),
    },
  );
}

export function withdrawArtifactFromGallery(
  listingId: string,
  expectedRevision: number,
  idempotencyKey: string,
) {
  return request<{ outcome: Record<string, unknown> }>(
    `/api/gallery-listings/${encodeURIComponent(listingId)}`,
    {
      method: "DELETE",
      headers: {
        "Idempotency-Key": idempotencyKey,
        "If-Match": `\"${expectedRevision}\"`,
      },
    },
  );
}

export type GalleryGovernanceCase = {
  id: string;
  queue: "proposals" | "reports" | "appeals" | "restrictions" | "takedowns" | "removals";
  state: string;
  createdAt: string;
  listingRevision: number | null;
  plainTextEvidence: string | null;
  allowedDecisions: string[];
};

const GALLERY_ADMIN_PAGE_SIZE = 24;
const GALLERY_ADMIN_DETAIL_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += concurrency) {
    const batch = items.slice(offset, offset + concurrency);
    results.push(...await Promise.all(batch.map(map)));
  }
  return results;
}

export async function listGalleryGovernanceCases() {
  const queues = ["proposals", "reports", "appeals", "restrictions", "takedowns", "removals"] as const;
  const items: Omit<GalleryGovernanceCase, "plainTextEvidence" | "allowedDecisions">[] = [];
  for (const queue of queues) {
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({
        queue,
        limit: String(GALLERY_ADMIN_PAGE_SIZE),
      });
      if (cursor) query.set("cursor", cursor);
      const page = await request<{items: Omit<GalleryGovernanceCase, "plainTextEvidence" | "allowedDecisions">[]; nextCursor: string | null}>(`/api/admin/gallery/cases?${query}`);
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
  }
  return mapWithConcurrency(items, GALLERY_ADMIN_DETAIL_CONCURRENCY, async (item) => {
    const detail = await request<{plainTextEvidence: string | null; allowedDecisions: string[]}>(`/api/admin/gallery/cases/${encodeURIComponent(item.id)}`);
    return {...item, plainTextEvidence: detail.plainTextEvidence, allowedDecisions: detail.allowedDecisions};
  });
}

export function decideGalleryCase(caseId: string, input: {decision: string; expectedListingRevision: number | null; ruleCode: string; rationale: string}, idempotencyKey: string) {
  return request<{decisionId: string; committedAt: string}>(`/api/admin/gallery/cases/${encodeURIComponent(caseId)}/decisions`, {method: "POST", headers: {"content-type": "application/json", "Idempotency-Key": idempotencyKey}, body: JSON.stringify(input)});
}

export async function listGalleryNotifications() {
  const result = await request<{items: Array<{id: string; category: string; rule: string; currentEffect: string; appeal: {deadlineAt: string} | null; createdAt: string}>; nextCursor: string | null}>("/api/gallery/notifications");
  return result.items;
}

export function appealGalleryDecision(decisionId: string, statement: string, idempotencyKey: string) {
  return request<{appealId: string}>(`/api/gallery-decisions/${encodeURIComponent(decisionId)}/appeals`, {method: "POST", headers: {"content-type": "application/json", "Idempotency-Key": idempotencyKey}, body: JSON.stringify({statement})});
}

export function featureGalleryListing(position: number, listingId: string, expectedListingRevision: number) {
  return request<{position: number; listingId: string}>(`/api/admin/gallery/featured-positions/${position}`, {method: "PUT", headers: {"content-type": "application/json"}, body: JSON.stringify({listingId, expectedListingRevision})});
}

export function removeFeaturedGalleryListing(position: number) {
  return request<void>(`/api/admin/gallery/featured-positions/${position}`, {method: "DELETE"});
}
