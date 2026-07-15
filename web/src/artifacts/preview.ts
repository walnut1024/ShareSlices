export function artifactPreviewUrl(artifactId: string, versionId: string): string {
  return `/artifacts/${encodeURIComponent(artifactId)}/preview?versionId=${encodeURIComponent(versionId)}`;
}

export function versionContentUrl(versionId: string): string {
  return `/api/versions/${encodeURIComponent(versionId)}/content/`;
}
