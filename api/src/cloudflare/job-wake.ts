export const cloudflareJobWakeLanes = [
  "authentication-email",
  "reconciliation",
  "artifact-processing",
  "thumbnail",
  "bundle-alias",
  "gallery-safety",
  "gallery-cover",
  "gallery-copy",
] as const;

export type CloudflareJobWakeLane = (typeof cloudflareJobWakeLanes)[number];

export type CloudflareJobWake = Readonly<{
  version: 1;
  wakeId: string;
  lane: CloudflareJobWakeLane;
  durableJobId?: string;
  createdAt: string;
}>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createCloudflareJobWake(input: Readonly<{
  lane: CloudflareJobWakeLane;
  durableJobId?: string;
  wakeId?: string;
  now?: Date;
}>): CloudflareJobWake {
  return {
    version: 1,
    wakeId: input.wakeId ?? crypto.randomUUID(),
    lane: input.lane,
    ...(input.durableJobId ? { durableJobId: input.durableJobId } : {}),
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export function parseCloudflareJobWake(value: unknown): CloudflareJobWake {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_job_wake");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["version", "wakeId", "lane", "durableJobId", "createdAt"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error("invalid_job_wake");
  if (record.version !== 1 || typeof record.wakeId !== "string" || !uuid.test(record.wakeId)) {
    throw new Error("invalid_job_wake");
  }
  if (!cloudflareJobWakeLanes.includes(record.lane as CloudflareJobWakeLane)) {
    throw new Error("invalid_job_wake");
  }
  if (record.durableJobId !== undefined && (
    typeof record.durableJobId !== "string" || record.durableJobId.length === 0 || record.durableJobId.length > 128
  )) {
    throw new Error("invalid_job_wake");
  }
  let normalizedCreatedAt: string | null = null;
  if (typeof record.createdAt === "string") {
    const createdAt = new Date(record.createdAt);
    if (!Number.isNaN(createdAt.getTime())) normalizedCreatedAt = createdAt.toISOString();
  }
  if (normalizedCreatedAt !== record.createdAt) {
    throw new Error("invalid_job_wake");
  }
  return record as CloudflareJobWake;
}
