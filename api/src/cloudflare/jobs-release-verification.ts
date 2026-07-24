import {createDatabaseConnection} from "../db/connection.js";
import {createReleaseVerificationRepository} from "./release-verification-repository.js";
import type {CloudflareExecutionContext} from "./runtime.js";

declare const scheduler: Readonly<{
  wait(milliseconds: number): Promise<void>;
}>;

type DurableObjectNamespace = Readonly<{
  idFromName(name: string): unknown;
  get(id: unknown): Readonly<{fetch(request: Request): Promise<Response>}>;
}>;

type VersionMetadata = Readonly<{
  id: string;
  tag?: string;
  timestamp: string;
}>;

export type JobsReleaseVerificationBindings = Readonly<{
  HYPERDRIVE: Readonly<{connectionString: string}>;
  CF_VERSION_METADATA: VersionMetadata;
  JOBS_RELEASE_BUNDLE_IDENTITY: string;
  JOBS_CONFIGURATION_DIGEST: string;
  JOBS_EXPORTS_DIGEST: string;
  TRUSTED_PROCESSING_IMAGE_REFERENCE: string;
  THUMBNAIL_IMAGE_REFERENCE: string;
  RELEASE_VERIFICATION_INVOCATION_LEASE_SECONDS: string;
  RELEASE_VERIFICATION_CONTAINER_WAIT_SECONDS: string;
  TRUSTED_PROCESSING_CONTAINERS: DurableObjectNamespace;
  THUMBNAIL_CONTAINERS: DurableObjectNamespace;
  TRUSTED_PROCESSING_STABLE_SLOTS: string;
  THUMBNAIL_STABLE_SLOTS: string;
}>;

type ProbeRequest = Readonly<{
  version: 1;
  invocationId: string;
  nonce: string;
  releaseId: string;
  fence: number;
  subFence: number;
}>;

const MAXIMUM_REQUEST_BYTES = 16 * 1024;

function notFound(): Response {
  return Response.json({error: "not_found"}, {
    status: 404,
    headers: {"Cache-Control": "no-store"},
  });
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseStableSlots(value: string): readonly string[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) &&
      parsed.length > 0 &&
      new Set(parsed).size === parsed.length &&
      parsed.every((slot) =>
        typeof slot === "string" &&
        /^[a-z0-9][a-z0-9-]{0,127}$/.test(slot)
      )
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function parseRequest(value: unknown): ProbeRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 6 ||
    record.version !== 1 ||
    typeof record.invocationId !== "string" ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(record.invocationId) ||
    typeof record.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(record.nonce) ||
    typeof record.releaseId !== "string" ||
    record.releaseId.length === 0 ||
    record.releaseId.length > 256 ||
    !Number.isSafeInteger(record.fence) ||
    Number(record.fence) <= 0 ||
    !Number.isSafeInteger(record.subFence) ||
    Number(record.subFence) <= 0
  ) {
    return null;
  }
  return record as ProbeRequest;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAXIMUM_REQUEST_BYTES)
  ) {
    throw new Error("release_verification_request_too_large");
  }
  if (!request.body) throw new Error("release_verification_request_missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > MAXIMUM_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("release_verification_request_too_large");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
}

function evidenceResponse(
  evidence: Record<string, unknown>,
  evidenceDigest: string,
): Response {
  return new Response(canonicalJson(evidence), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-ShareSlices-Evidence-Digest": evidenceDigest,
    },
  });
}

async function dispatchContainerProbes(
  scope: ProbeRequest,
  bindings: JobsReleaseVerificationBindings,
  slots: Readonly<{
    trustedProcessing: readonly string[];
    thumbnail: readonly string[];
  }>,
): Promise<void> {
  for (const [containerClass, namespace, stableSlots] of [
    [
      "trusted-processing",
      bindings.TRUSTED_PROCESSING_CONTAINERS,
      slots.trustedProcessing,
    ],
    ["thumbnail", bindings.THUMBNAIL_CONTAINERS, slots.thumbnail],
  ] as const) {
    for (const stableSlot of stableSlots) {
      const stub = namespace.get(namespace.idFromName(stableSlot));
      const response = await stub.fetch(new Request(
        "https://container.invalid/internal/release-verification",
        {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({
            version: 1,
            nonce: scope.nonce,
            releaseId: scope.releaseId,
            fence: scope.fence,
            subFence: scope.subFence,
            containerClass,
            stableSlot,
          }),
        },
      ));
      if (response.status !== 202) {
        throw new Error("release_verification_container_dispatch_failed");
      }
    }
  }
}

export function createJobsReleaseVerificationFetch() {
  return async (
    request: Request,
    bindings: JobsReleaseVerificationBindings,
    _context: CloudflareExecutionContext,
  ): Promise<Response> => {
    const url = new URL(request.url);
    if (
      request.method !== "POST" ||
      url.protocol !== "http:" ||
      url.hostname !== "shareslices-jobs.internal" ||
      url.pathname !== "/v1/release-verification"
    ) {
      return notFound();
    }
    let body: unknown;
    try {
      body = await readBoundedJson(request);
    } catch {
      return notFound();
    }
    const scope = parseRequest(body);
    const leaseSeconds = parsePositiveInteger(
      bindings.RELEASE_VERIFICATION_INVOCATION_LEASE_SECONDS,
    );
    const waitSeconds = parsePositiveInteger(
      bindings.RELEASE_VERIFICATION_CONTAINER_WAIT_SECONDS,
    );
    const trustedProcessingSlots = parseStableSlots(
      bindings.TRUSTED_PROCESSING_STABLE_SLOTS,
    );
    const thumbnailSlots = parseStableSlots(bindings.THUMBNAIL_STABLE_SLOTS);
    if (
      !scope ||
      !leaseSeconds ||
      !waitSeconds ||
      waitSeconds >= leaseSeconds ||
      !trustedProcessingSlots ||
      !thumbnailSlots
    ) {
      return notFound();
    }

    const connection = createDatabaseConnection({
      mode: "hyperdrive",
      cache: "disabled",
      connectionString: bindings.HYPERDRIVE.connectionString,
      maxConnections: 1,
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 1_000,
    });
    const repository = createReleaseVerificationRepository(connection);
    try {
      const begin = await repository.begin(
        scope,
        leaseSeconds,
      );
      if (!begin) return notFound();
      if (begin.state === "completed") {
        return evidenceResponse(begin.evidence, begin.evidenceDigest);
      }
      await dispatchContainerProbes(scope, bindings, {
        trustedProcessing: trustedProcessingSlots,
        thumbnail: thumbnailSlots,
      });
      const expectedContainerCount =
        trustedProcessingSlots.length + thumbnailSlots.length;
      const deadline = Date.now() + waitSeconds * 1_000;
      let containers = await repository.listContainerEvidence(scope);
      while (containers.length !== expectedContainerCount && Date.now() < deadline) {
        await scheduler.wait(250);
        containers = await repository.listContainerEvidence(scope);
      }
      if (containers.length !== expectedContainerCount) {
        throw new Error("release_verification_container_convergence_timeout");
      }
      const evidence = {
        version: 1,
        scope: {
          nonce: scope.nonce,
          releaseId: scope.releaseId,
          fence: scope.fence,
          subFence: scope.subFence,
        },
        jobsWorker: {
          versionId: bindings.CF_VERSION_METADATA.id,
          ...(bindings.CF_VERSION_METADATA.tag
            ? {versionTag: bindings.CF_VERSION_METADATA.tag}
            : {}),
          versionTimestamp: bindings.CF_VERSION_METADATA.timestamp,
          releaseBundleIdentity: bindings.JOBS_RELEASE_BUNDLE_IDENTITY,
          configurationDigest: bindings.JOBS_CONFIGURATION_DIGEST,
          exportsDigest: bindings.JOBS_EXPORTS_DIGEST,
        },
        migrationHead: begin.migrationHead,
        database: {mode: "hyperdrive", reachable: true},
        broker: {
          origin: "http://shareslices-broker.internal",
          publicIngress: false,
        },
        configuredContainerImages: {
          trustedProcessing: bindings.TRUSTED_PROCESSING_IMAGE_REFERENCE,
          thumbnail: bindings.THUMBNAIL_IMAGE_REFERENCE,
        },
        containers,
        containerConvergence: "verified",
      };
      const serialized = canonicalJson(evidence);
      const evidenceDigest = await sha256(serialized);
      if (!(await repository.complete(scope, evidenceDigest, evidence))) {
        return notFound();
      }
      return evidenceResponse(evidence, evidenceDigest);
    } catch (error) {
      try {
        await repository.fail(scope, "jobs_release_verification_failed");
      } catch {
        // Preserve the original verification failure.
      }
      throw error;
    } finally {
      await connection.close();
    }
  };
}
