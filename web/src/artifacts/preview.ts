import { destinations } from "../routing";

export function artifactPreviewUrl(artifactId: string, versionId: string): string {
  return destinations.preview(artifactId, versionId);
}

export function versionContentUrl(versionId: string): string {
  return `/api/versions/${encodeURIComponent(versionId)}/content/`;
}
