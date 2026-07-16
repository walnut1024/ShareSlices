import { z } from "zod";

export const supportedGalleryJobContractVersions = ["gallery-job/v1", "gallery-job/v0"] as const;

const attemptSchema = z.object({
  attemptId: z.string().min(1),
  attemptNumber: z.number().int().positive(),
  fenceToken: z.number().int().positive(),
  leaseExpiresAt: z.iso.datetime()
}).strict();

const inputSchema = z.object({
  snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
  listingId: z.string().min(1),
  listingRevision: z.number().int().positive(),
  versionId: z.string().min(1),
  objectLayoutRevision: z.string().min(1),
  policyRevision: z.string().min(1),
  destinationOwnerUserId: z.string().min(1).optional(),
  destinationArtifactId: z.string().min(1).optional(),
  reservedArtifactCount: z.number().int().nonnegative().optional(),
  reservedStorageBytes: z.number().int().nonnegative().optional(),
  sourceRetentionReferenceId: z.string().min(1).optional()
}).strict();

const resultSchema = z.object({
  state: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "indeterminate"]),
  terminalResult: z.enum(["cover_ready", "safety_pass", "safety_reject", "safety_review", "copy_ready"]).nullable(),
  failureCode: z.enum(["invalid_input", "policy_rejected", "render_failed", "source_unavailable", "quota_unavailable", "incompatible_contract", "lease_lost", "cancelled", "internal_failure"]).nullable(),
  outputObjectKey: z.string().nullable(),
  evidenceDigest: z.string().nullable(),
  quotaEffect: z.enum(["none", "hold", "commit", "release"]),
  sourceRetentionEffect: z.enum(["none", "hold", "release"])
}).strict();

const galleryJobSchema = z.object({
  contractVersion: z.enum(supportedGalleryJobContractVersions),
  jobKind: z.enum(["cover", "safety", "copy"]),
  jobId: z.string().min(1),
  attempt: attemptSchema,
  input: inputSchema,
  result: resultSchema
}).strict();

export type GalleryJobEnvelope = z.infer<typeof galleryJobSchema>;

export function parseGalleryJobEnvelope(value: unknown): GalleryJobEnvelope {
  const job = galleryJobSchema.parse(value);
  const copyFields = [
    job.input.destinationOwnerUserId,
    job.input.destinationArtifactId,
    job.input.reservedArtifactCount,
    job.input.reservedStorageBytes,
    job.input.sourceRetentionReferenceId
  ];
  if (job.jobKind === "copy" && copyFields.some((field) => field === undefined)) {
    throw new Error("copy jobs require the complete API-owned destination, quota, and retention snapshot");
  }
  if (job.jobKind !== "copy" && copyFields.some((field) => field !== undefined)) {
    throw new Error("only copy jobs may contain destination, quota, or source-retention input");
  }
  return job;
}
