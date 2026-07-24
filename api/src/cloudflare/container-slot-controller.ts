import type {CloudflareJobWake} from "./job-wake.js";

export type CloudflareContainerLane = "artifact-processing" | "thumbnail";

type DurableObjectNamespace = Readonly<{
  idFromName(name: string): unknown;
  get(id: unknown): Readonly<{fetch(request: Request): Promise<Response>}>;
}>;

export type ContainerSlotBindings = Readonly<{
  TRUSTED_PROCESSING_CONTAINERS: DurableObjectNamespace;
  THUMBNAIL_CONTAINERS: DurableObjectNamespace;
  TRUSTED_PROCESSING_STABLE_SLOTS: string;
  THUMBNAIL_STABLE_SLOTS: string;
  TRUSTED_PROCESSING_MAXIMUM_WALL_TIME_SECONDS: string;
  THUMBNAIL_MAXIMUM_WALL_TIME_SECONDS: string;
  CONTAINER_RELEASE_ID: string;
  CONTAINER_CONTRACT_REVISION: string;
}>;

export type ContainerHandoff = Readonly<{
  wakeId: string;
  durableJobId: string;
  lane: CloudflareContainerLane;
  slot: string;
  releaseId: string;
  contractRevision: string;
  handedOffAt: string;
}>;

export type ContainerWakeAuthorization = Readonly<{
  bootstrapGrant?: string;
}>;

function parsePositiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid_cloudflare_binding_${name}`);
  }
  return parsed;
}

function parseStableSlots(name: string, value: string): readonly string[] {
  let slots: unknown;
  try {
    slots = JSON.parse(value);
  } catch {
    throw new Error(`invalid_cloudflare_binding_${name}`);
  }
  if (
    !Array.isArray(slots) ||
    slots.length === 0 ||
    new Set(slots).size !== slots.length ||
    slots.some((slot) => typeof slot !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(slot))
  ) {
    throw new Error(`invalid_cloudflare_binding_${name}`);
  }
  return slots;
}

function stableIndex(value: string, size: number): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % size;
}

function laneConfiguration(bindings: ContainerSlotBindings, lane: CloudflareContainerLane) {
  if (lane === "artifact-processing") {
    return {
      namespace: bindings.TRUSTED_PROCESSING_CONTAINERS,
      slots: parseStableSlots(
        "trusted_processing_stable_slots",
        bindings.TRUSTED_PROCESSING_STABLE_SLOTS,
      ),
      maximumWallTimeSeconds: parsePositiveInteger(
        "trusted_processing_maximum_wall_time_seconds",
        bindings.TRUSTED_PROCESSING_MAXIMUM_WALL_TIME_SECONDS,
      ),
    };
  }
  return {
    namespace: bindings.THUMBNAIL_CONTAINERS,
    slots: parseStableSlots(
      "thumbnail_stable_slots",
      bindings.THUMBNAIL_STABLE_SLOTS,
    ),
    maximumWallTimeSeconds: parsePositiveInteger(
      "thumbnail_maximum_wall_time_seconds",
      bindings.THUMBNAIL_MAXIMUM_WALL_TIME_SECONDS,
    ),
  };
}

export async function handoffContainerWake(input: Readonly<{
  bindings: ContainerSlotBindings;
  wake: CloudflareJobWake;
  now?: Date;
  authorizeWake(
    wake: CloudflareJobWake,
  ): Promise<ContainerWakeAuthorization | void>;
  recordHandoff(handoff: ContainerHandoff): Promise<void>;
}>): Promise<ContainerHandoff> {
  if (
    (input.wake.lane !== "artifact-processing" && input.wake.lane !== "thumbnail") ||
    !input.wake.durableJobId
  ) {
    throw new Error("container_wake_lane_unsupported");
  }
  const authorization = await input.authorizeWake(input.wake);
  const lane = input.wake.lane;
  const configuration = laneConfiguration(input.bindings, lane);
  const slot = configuration.slots[
    stableIndex(input.wake.durableJobId, configuration.slots.length)
  ];
  if (!slot) throw new Error("container_stable_slot_unavailable");
  const stub = configuration.namespace.get(configuration.namespace.idFromName(slot));
  const response = await stub.fetch(new Request("https://container.invalid/internal/wake", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      version: 1,
      wakeId: input.wake.wakeId,
      durableJobId: input.wake.durableJobId,
      lane,
      slot,
      releaseId: input.bindings.CONTAINER_RELEASE_ID,
      contractRevision: input.bindings.CONTAINER_CONTRACT_REVISION,
      maximumWallTimeSeconds: configuration.maximumWallTimeSeconds,
      ...(authorization?.bootstrapGrant
        ? {bootstrapGrant: authorization.bootstrapGrant}
        : {}),
    }),
  }));
  if (!response.ok) throw new Error("container_controller_handoff_failed");
  const handoff = Object.freeze({
    wakeId: input.wake.wakeId,
    durableJobId: input.wake.durableJobId,
    lane,
    slot,
    releaseId: input.bindings.CONTAINER_RELEASE_ID,
    contractRevision: input.bindings.CONTAINER_CONTRACT_REVISION,
    handedOffAt: (input.now ?? new Date()).toISOString(),
  });
  await input.recordHandoff(handoff);
  return handoff;
}
