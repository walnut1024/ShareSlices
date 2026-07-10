import type { Artifact } from "../api/artifacts";

export function artifactStatus(artifact: Artifact): { label: string; className: string } {
  if (artifact.processingState === "failed") {
    return { label: "Needs attention", className: "border-red-200 bg-red-50 text-red-700" };
  }
  if (artifact.processingState === "accepted") {
    return { label: "Accepted", className: "border-blue-200 bg-blue-50 text-blue-700" };
  }
  if (artifact.processingState === "processing") {
    return { label: "Processing", className: "border-amber-200 bg-amber-50 text-amber-800" };
  }
  if (artifact.publication) {
    return { label: "Published", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  }
  return { label: "Ready to publish", className: "border-neutral-200 bg-neutral-100 text-neutral-700" };
}

export function ArtifactStatus({ artifact }: { artifact: Artifact }) {
  const status = artifactStatus(artifact);
  return <span className={`inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium ${status.className}`}>{status.label}</span>;
}
