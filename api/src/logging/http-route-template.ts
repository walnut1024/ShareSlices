const galleryRoutes: readonly [RegExp, string][] = [
  [/^\/gallery-content\/public\/[^/]+(?:\/.*)?$/, "/gallery-content/public/{playerAuthorization}/{assetPath}"],
  [/^\/gallery-content\/review\/[^/]+(?:\/.*)?$/, "/gallery-content/review/{reviewAuthorization}/{assetPath}"],
  [/^\/api\/admin\/gallery\/cases\/[^/]+\/review-authorizations$/, "/api/admin/gallery/cases/{caseId}/review-authorizations"],
  [/^\/api\/admin\/gallery\/cases\/[^/]+\/decisions$/, "/api/admin/gallery/cases/{caseId}/decisions"],
  [/^\/api\/admin\/gallery\/cases\/[^/]+$/, "/api/admin/gallery/cases/{caseId}"],
  [/^\/api\/admin\/gallery\/featured-positions\/[^/]+$/, "/api/admin/gallery/featured-positions/{position}"],
  [/^\/api\/gallery-copy-operations\/[^/]+$/, "/api/gallery-copy-operations/{operationId}"],
  [/^\/api\/gallery\/[^/]+\/copy-operations$/, "/api/gallery/{gallerySlug}/copy-operations"],
  [/^\/api\/gallery-decisions\/[^/]+\/appeals$/, "/api/gallery-decisions/{decisionId}/appeals"],
  [/^\/api\/gallery-listings\/[^/]+$/, "/api/gallery-listings/{listingId}"],
  [/^\/gallery\/creators\/[^/]+$/, "/gallery/creators/{creatorSlug}"],
  [/^\/gallery\/tags\/[^/]+$/, "/gallery/tags/{tag}"],
  [/^\/gallery\/[^/]+\/player-authorizations$/, "/gallery/{gallerySlug}/player-authorizations"],
  [/^\/gallery\/[^/]+\/download$/, "/gallery/{gallerySlug}/download"],
  [/^\/gallery\/[^/]+\/reports$/, "/gallery/{gallerySlug}/reports"],
  [/^\/gallery\/[^/]+$/, "/gallery/{gallerySlug}"],
  [/^\/a\/[^/]+(?:\/.*)?$/, "/a/{shareSlug}/{assetPath}"]
];

export function httpRouteTemplate(path: string): string {
  return galleryRoutes.find(([pattern]) => pattern.test(path))?.[1] ?? path;
}
