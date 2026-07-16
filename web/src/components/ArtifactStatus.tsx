import type { Artifact } from "../api/artifacts";
import { Badge } from "./ui/badge";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function artifactStatus(artifact: Artifact): { label: string; variant: BadgeVariant; className?: string } {
  if (artifact.processingState === "failed") {
    return { label: "Needs attention", variant: "destructive" };
  }
  if (artifact.processingState === "accepted") {
    return { label: "Accepted", variant: "outline", className: "border-[var(--info)]/20 bg-[var(--info)]/10 text-[var(--info)]" };
  }
  if (artifact.processingState === "processing") {
    return { label: "Processing", variant: "outline", className: "border-[var(--warning)]/20 bg-[var(--warning)]/10 text-[var(--warning)]" };
  }
  if (artifact.publicationStatus === "published") {
    return { label: "Published", variant: "outline", className: "border-[var(--success)]/20 bg-[var(--success)]/10 text-[var(--success)]" };
  }
  if (artifact.publicationStatus === "expired") return { label: "Expired", variant: "outline", className: "border-[var(--warning)]/20 bg-[var(--warning)]/10 text-[var(--warning)]" };
  if (artifact.publicationStatus === "unpublished") return { label: "Unpublished", variant: "secondary" };
  return { label: "Not published", variant: "secondary" };
}

export function ArtifactStatus({ artifact }: { artifact: Artifact }) {
  const status = artifactStatus(artifact);
  return <Badge variant={status.variant} className={status.className}>{status.label}</Badge>;
}
