import type { Artifact } from "../api/artifacts";
import { Badge } from "./ui/badge";

export function artifactStatus(artifact: Artifact): { label: string; className: string } {
  if (artifact.processingState === "failed") {
    return { label: "Needs attention", className: "border-destructive/20 bg-destructive/10 text-destructive" };
  }
  if (artifact.processingState === "accepted") {
    return { label: "Accepted", className: "border-[var(--info)]/20 bg-[var(--info)]/10 text-[var(--info)]" };
  }
  if (artifact.processingState === "processing") {
    return { label: "Processing", className: "border-[var(--warning)]/20 bg-[var(--warning)]/10 text-[var(--warning)]" };
  }
  if (artifact.publication) {
    return { label: "Published", className: "border-[var(--success)]/20 bg-[var(--success)]/10 text-[var(--success)]" };
  }
  return { label: "Ready to publish", className: "border-neutral-200 bg-neutral-100 text-neutral-700" };
}

export function ArtifactStatus({ artifact }: { artifact: Artifact }) {
  const status = artifactStatus(artifact);
  return <Badge variant="outline" className={status.className}>{status.label}</Badge>;
}
