export type CloudflareVersionMetadata = Readonly<{
  id: string;
  tag?: string;
  timestamp: string;
}>;

export function releaseVersionEvidence(
  request: Request,
  internalHost: string,
  metadata: CloudflareVersionMetadata,
): Response | null {
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.protocol !== "http:" ||
    url.hostname !== internalHost ||
    url.pathname !== "/health" ||
    !metadata ||
    typeof metadata.id !== "string" ||
    metadata.id.length === 0
  ) {
    return null;
  }
  return Response.json({
    version: 1,
    versionId: metadata.id,
    ...(metadata.tag ? {versionTag: metadata.tag} : {}),
  }, {
    headers: {"Cache-Control": "no-store"},
  });
}
