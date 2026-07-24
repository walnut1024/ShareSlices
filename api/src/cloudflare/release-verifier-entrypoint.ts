import type {
  CloudflareExecutionContext,
  CloudflareQueueBatch,
} from "./runtime.js";

type ServiceBinding = Readonly<{
  fetch(request: Request): Promise<Response>;
}>;

export type CloudflareReleaseVerifierBindings = Readonly<{
  JOBS_RELEASE_VERIFICATION: ServiceBinding;
  VERIFIER_QUEUE_NAME: string;
}>;

type ExpectedContainer = Readonly<{
  containerClass: "trusted-processing" | "thumbnail";
  stableSlot: string;
  providerInstance: string;
  buildIdentity: string;
  contractRevision: string;
  imageReference: string;
}>;

type ReleaseVerificationMessage = Readonly<{
  version: 1;
  invocationId: string;
  nonce: string;
  releaseId: string;
  fence: number;
  subFence: number;
  lifecycle: Readonly<{
    tombstoneSeconds: number;
    quiescenceSeconds: number;
  }>;
  expected: Readonly<{
    jobsWorker: Readonly<{
      versionId: string;
      releaseBundleIdentity: string;
      configurationDigest: string;
      exportsDigest: string;
    }>;
    migrationHead: string;
    configuredContainerImages: Readonly<{
      trustedProcessing: string;
      thumbnail: string;
    }>;
    containers: readonly ExpectedContainer[];
  }>;
}>;

type ReleaseCleanupMessage = Readonly<{
  version: 1;
  operation: "cleanup";
  nonce: string;
  releaseId: string;
  fence: number;
}>;

const MAXIMUM_EVIDENCE_BYTES = 256 * 1024;

function isNonEmptyString(value: unknown, maximum = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function parseContainer(value: unknown): ExpectedContainer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const container = value as Record<string, unknown>;
  if (
    Object.keys(container).length !== 6 ||
    (container.containerClass !== "trusted-processing" &&
      container.containerClass !== "thumbnail") ||
    !isNonEmptyString(container.stableSlot, 128) ||
    !/^[a-z0-9][a-z0-9-]{0,127}$/.test(container.stableSlot) ||
    !isNonEmptyString(container.providerInstance, 256) ||
    !isNonEmptyString(container.buildIdentity) ||
    !isNonEmptyString(container.contractRevision, 256) ||
    !isNonEmptyString(container.imageReference)
  ) {
    return null;
  }
  return container as ExpectedContainer;
}

function parseMessage(value: unknown): ReleaseVerificationMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  const expected = message.expected;
  const lifecycle = message.lifecycle;
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    return null;
  }
  const expectedRecord = expected as Record<string, unknown>;
  const jobsWorker = expectedRecord.jobsWorker;
  const images = expectedRecord.configuredContainerImages;
  const containers = expectedRecord.containers;
  if (
    Object.keys(message).length !== 8 ||
    message.version !== 1 ||
    !isNonEmptyString(message.invocationId, 256) ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(message.invocationId) ||
    !isNonEmptyString(message.nonce, 256) ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(message.nonce) ||
    !isNonEmptyString(message.releaseId, 256) ||
    !Number.isSafeInteger(message.fence) ||
    Number(message.fence) <= 0 ||
    !Number.isSafeInteger(message.subFence) ||
    Number(message.subFence) <= 0 ||
    !lifecycle ||
    typeof lifecycle !== "object" ||
    Array.isArray(lifecycle) ||
    Object.keys(lifecycle).length !== 2 ||
    !Number.isSafeInteger((lifecycle as Record<string, unknown>).tombstoneSeconds) ||
    Number((lifecycle as Record<string, unknown>).tombstoneSeconds) <= 0 ||
    !Number.isSafeInteger((lifecycle as Record<string, unknown>).quiescenceSeconds) ||
    Number((lifecycle as Record<string, unknown>).quiescenceSeconds) <= 0 ||
    Number((lifecycle as Record<string, unknown>).quiescenceSeconds) >=
      Number((lifecycle as Record<string, unknown>).tombstoneSeconds) ||
    Object.keys(expectedRecord).length !== 4 ||
    !jobsWorker ||
    typeof jobsWorker !== "object" ||
    Array.isArray(jobsWorker) ||
    Object.keys(jobsWorker).sort().join("\n") !== [
      "configurationDigest",
      "exportsDigest",
      "releaseBundleIdentity",
      "versionId",
    ].join("\n") ||
    !Object.values(jobsWorker).every((entry) => isNonEmptyString(entry)) ||
    !isNonEmptyString(expectedRecord.migrationHead) ||
    !images ||
    typeof images !== "object" ||
    Array.isArray(images) ||
    Object.keys(images).sort().join("\n") !== [
      "thumbnail",
      "trustedProcessing",
    ].join("\n") ||
    !isNonEmptyString((images as Record<string, unknown>).trustedProcessing) ||
    !isNonEmptyString((images as Record<string, unknown>).thumbnail) ||
    !Array.isArray(containers) ||
    containers.length < 2
  ) {
    return null;
  }
  const parsedContainers = containers.map(parseContainer);
  if (
    parsedContainers.some((container) => !container) ||
    new Set(parsedContainers.map((container) =>
      `${container!.containerClass}\0${container!.stableSlot}`
    )).size !== parsedContainers.length ||
    new Set(parsedContainers.map((container) => container!.providerInstance)).size !==
      parsedContainers.length
  ) {
    return null;
  }
  const parsedJobs = jobsWorker as Record<string, string>;
  const parsedImages = images as Record<string, string>;
  return {
    version: 1,
    invocationId: message.invocationId,
    nonce: message.nonce,
    releaseId: message.releaseId,
    fence: Number(message.fence),
    subFence: Number(message.subFence),
    lifecycle: {
      tombstoneSeconds: Number(
        (lifecycle as Record<string, unknown>).tombstoneSeconds,
      ),
      quiescenceSeconds: Number(
        (lifecycle as Record<string, unknown>).quiescenceSeconds,
      ),
    },
    expected: {
      jobsWorker: {
        versionId: parsedJobs.versionId!,
        releaseBundleIdentity: parsedJobs.releaseBundleIdentity!,
        configurationDigest: parsedJobs.configurationDigest!,
        exportsDigest: parsedJobs.exportsDigest!,
      },
      migrationHead: expectedRecord.migrationHead as string,
      configuredContainerImages: {
        trustedProcessing: parsedImages.trustedProcessing!,
        thumbnail: parsedImages.thumbnail!,
      },
      containers: parsedContainers as ExpectedContainer[],
    },
  };
}

function parseCleanupMessage(value: unknown): ReleaseCleanupMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (
    Object.keys(message).length !== 5 ||
    message.version !== 1 ||
    message.operation !== "cleanup" ||
    !isNonEmptyString(message.nonce, 256) ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(message.nonce) ||
    !isNonEmptyString(message.releaseId, 256) ||
    !Number.isSafeInteger(message.fence) ||
    Number(message.fence) <= 0
  ) {
    return null;
  }
  return message as ReleaseCleanupMessage;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256:${[...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) throw new Error("release_verifier_evidence_missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > MAXIMUM_EVIDENCE_BYTES) {
      await reader.cancel();
      throw new Error("release_verifier_evidence_too_large");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
}

function containerProjection(value: unknown): readonly ExpectedContainer[] | null {
  if (!Array.isArray(value)) return null;
  const projected = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    return parseContainer({
      containerClass: record.containerClass,
      stableSlot: record.stableSlot,
      providerInstance: record.providerInstance,
      buildIdentity: record.buildIdentity,
      contractRevision: record.contractRevision,
      imageReference: record.imageReference,
    });
  });
  return projected.some((entry) => !entry)
    ? null
    : projected as ExpectedContainer[];
}

function sortedContainers(containers: readonly ExpectedContainer[]) {
  return [...containers].sort((left, right) =>
    `${left.containerClass}\0${left.stableSlot}`.localeCompare(
      `${right.containerClass}\0${right.stableSlot}`,
    )
  );
}

function verifyEvidence(
  message: ReleaseVerificationMessage,
  evidence: unknown,
): void {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("release_verifier_evidence_invalid");
  }
  const record = evidence as Record<string, unknown>;
  const scope = record.scope as Record<string, unknown> | undefined;
  const jobsWorker = record.jobsWorker as Record<string, unknown> | undefined;
  const images = record.configuredContainerImages as
    | Record<string, unknown>
    | undefined;
  const containers = containerProjection(record.containers);
  if (
    record.version !== 1 ||
    record.containerConvergence !== "verified" ||
    !scope ||
    scope.nonce !== message.nonce ||
    scope.releaseId !== message.releaseId ||
    scope.fence !== message.fence ||
    scope.subFence !== message.subFence ||
    !jobsWorker ||
    jobsWorker.versionId !== message.expected.jobsWorker.versionId ||
    jobsWorker.releaseBundleIdentity !==
      message.expected.jobsWorker.releaseBundleIdentity ||
    jobsWorker.configurationDigest !==
      message.expected.jobsWorker.configurationDigest ||
    jobsWorker.exportsDigest !== message.expected.jobsWorker.exportsDigest ||
    record.migrationHead !== message.expected.migrationHead ||
    !images ||
    images.trustedProcessing !==
      message.expected.configuredContainerImages.trustedProcessing ||
    images.thumbnail !== message.expected.configuredContainerImages.thumbnail ||
    !containers ||
    canonicalJson(sortedContainers(containers)) !==
      canonicalJson(sortedContainers(message.expected.containers))
  ) {
    throw new Error("release_verifier_evidence_mismatch");
  }
}

export function createCloudflareReleaseVerifier() {
  return Object.freeze({
    async queue(
      batch: CloudflareQueueBatch<unknown>,
      bindings: CloudflareReleaseVerifierBindings,
      _context: CloudflareExecutionContext,
    ): Promise<void> {
      if (
        batch.queue !== bindings.VERIFIER_QUEUE_NAME ||
        batch.messages.length !== 1
      ) {
        throw new Error("release_verifier_queue_scope_invalid");
      }
      const cleanup = parseCleanupMessage(batch.messages[0]!.body);
      if (cleanup) {
        const response = await bindings.JOBS_RELEASE_VERIFICATION.fetch(
          new Request(
            "http://shareslices-jobs.internal/v1/release-verification/cleanup",
            {
              method: "POST",
              headers: {"content-type": "application/json"},
              body: JSON.stringify({
                version: 1,
                nonce: cleanup.nonce,
                releaseId: cleanup.releaseId,
                fence: cleanup.fence,
              }),
            },
          ),
        );
        if (response.status !== 200) {
          throw new Error("release_verifier_cleanup_rejected");
        }
        const body = await response.json() as Record<string, unknown>;
        if (
          body.state !== "complete" ||
          body.cleanupState !== "complete" ||
          body.nonce !== cleanup.nonce ||
          body.releaseId !== cleanup.releaseId ||
          body.fence !== cleanup.fence
        ) {
          throw new Error("release_verifier_cleanup_evidence_mismatch");
        }
        batch.messages[0]!.ack();
        return;
      }
      const message = parseMessage(batch.messages[0]!.body);
      if (!message) throw new Error("release_verifier_message_invalid");
      const response = await bindings.JOBS_RELEASE_VERIFICATION.fetch(
        new Request("http://shareslices-jobs.internal/v1/release-verification", {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({
            version: 1,
            invocationId: message.invocationId,
            nonce: message.nonce,
            releaseId: message.releaseId,
            fence: message.fence,
            subFence: message.subFence,
          }),
        }),
      );
      if (response.status !== 200) {
        throw new Error("release_verifier_jobs_probe_rejected");
      }
      const serialized = await readBoundedResponse(response);
      const evidenceDigest = response.headers.get(
        "x-shareslices-evidence-digest",
      );
      if (!evidenceDigest || await digest(serialized) !== evidenceDigest) {
        throw new Error("release_verifier_evidence_digest_mismatch");
      }
      verifyEvidence(message, JSON.parse(serialized));
      const terminal = await bindings.JOBS_RELEASE_VERIFICATION.fetch(
        new Request(
          "http://shareslices-jobs.internal/v1/release-verification/finalize",
          {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({
              version: 1,
              invocationId: message.invocationId,
              nonce: message.nonce,
              releaseId: message.releaseId,
              fence: message.fence,
              subFence: message.subFence,
              evidenceDigest,
              tombstoneSeconds: message.lifecycle.tombstoneSeconds,
              quiescenceSeconds: message.lifecycle.quiescenceSeconds,
            }),
          },
        ),
      );
      if (terminal.status !== 200) {
        throw new Error("release_verifier_terminal_fence_rejected");
      }
      const terminalBody = await terminal.json() as Record<string, unknown>;
      if (
        terminalBody.state !== "terminal" ||
        terminalBody.cleanupState !== "quiescing" ||
        terminalBody.nonce !== message.nonce ||
        terminalBody.releaseId !== message.releaseId ||
        terminalBody.fence !== message.fence ||
        terminalBody.terminalSubFence !== message.subFence + 1 ||
        terminalBody.tombstoneSeconds !== message.lifecycle.tombstoneSeconds ||
        terminalBody.quiescenceSeconds !== message.lifecycle.quiescenceSeconds
      ) {
        throw new Error("release_verifier_terminal_evidence_mismatch");
      }
      batch.messages[0]!.ack();
    },
  });
}

export default createCloudflareReleaseVerifier();
