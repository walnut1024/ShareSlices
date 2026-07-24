import {createDatabaseConnection} from "../db/connection.js";
import type {R2BucketBinding} from "../storage/r2-object-storage.js";
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
  ARTIFACTS: R2BucketBinding;
}>;

type ProbeRequest = Readonly<{
  version: 1;
  invocationId: string;
  nonce: string;
  releaseId: string;
  fence: number;
  subFence: number;
}>;

type FinalizeRequest = ProbeRequest & Readonly<{
  evidenceDigest: string;
  tombstoneSeconds: number;
  quiescenceSeconds: number;
}>;

type CleanupRequest = Readonly<{
  version: 1;
  nonce: string;
  releaseId: string;
  fence: number;
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

function parseFinalizeRequest(value: unknown): FinalizeRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const probe = parseRequest(Object.fromEntries(
    Object.entries(record).filter(([key]) =>
      ![
        "evidenceDigest",
        "tombstoneSeconds",
        "quiescenceSeconds",
      ].includes(key)
    ),
  ));
  if (
    Object.keys(record).length !== 9 ||
    !probe ||
    typeof record.evidenceDigest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(record.evidenceDigest) ||
    !Number.isSafeInteger(record.tombstoneSeconds) ||
    Number(record.tombstoneSeconds) <= 0 ||
    !Number.isSafeInteger(record.quiescenceSeconds) ||
    Number(record.quiescenceSeconds) <= 0 ||
    Number(record.quiescenceSeconds) >= Number(record.tombstoneSeconds)
  ) {
    return null;
  }
  return {
    ...probe,
    evidenceDigest: record.evidenceDigest,
    tombstoneSeconds: Number(record.tombstoneSeconds),
    quiescenceSeconds: Number(record.quiescenceSeconds),
  };
}

function parseCleanupRequest(value: unknown): CleanupRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 4 ||
    record.version !== 1 ||
    typeof record.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(record.nonce) ||
    typeof record.releaseId !== "string" ||
    record.releaseId.length < 1 ||
    record.releaseId.length > 256 ||
    !Number.isSafeInteger(record.fence) ||
    Number(record.fence) <= 0
  ) {
    return null;
  }
  return record as CleanupRequest;
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
            invocationId: scope.invocationId,
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

function syntheticResourceKey(scope: ProbeRequest, suffix: string): string {
  return `release-verification/${scope.nonce}/${suffix}`;
}

async function exerciseSyntheticResources(
  scope: ProbeRequest,
  bindings: JobsReleaseVerificationBindings,
  repository: ReturnType<typeof createReleaseVerificationRepository>,
) {
  const databaseKey = syntheticResourceKey(scope, "database/jobs-worker");
  if (
    !(await repository.prepareSyntheticResource(scope, "database", databaseKey)) ||
    !(await repository.commitSyntheticResource(scope, "database", databaseKey))
  ) {
    throw new Error("release_verification_database_probe_fenced");
  }
  const r2Key = syntheticResourceKey(
    scope,
    `r2/${scope.invocationId}.json`,
  );
  if (!(await repository.prepareSyntheticResource(scope, "r2", r2Key))) {
    throw new Error("release_verification_r2_probe_fenced");
  }
  const payload = canonicalJson({
    version: 1,
    nonce: scope.nonce,
    releaseId: scope.releaseId,
    fence: scope.fence,
    subFence: scope.subFence,
  });
  const bytes = new TextEncoder().encode(payload);
  const stored = await bindings.ARTIFACTS.put(
    r2Key,
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    {httpMetadata: {contentType: "application/json"}},
  );
  if (!stored) throw new Error("release_verification_r2_write_rejected");
  const read = await bindings.ARTIFACTS.get(r2Key);
  if (!read) throw new Error("release_verification_r2_read_missing");
  const readBytes = new Uint8Array(await new Response(read.body).arrayBuffer());
  if (
    readBytes.byteLength !== bytes.byteLength ||
    readBytes.some((byte, index) => byte !== bytes[index])
  ) {
    throw new Error("release_verification_r2_read_mismatch");
  }
  if (!(await repository.commitSyntheticResource(scope, "r2", r2Key))) {
    await bindings.ARTIFACTS.delete(r2Key);
    throw new Error("release_verification_r2_commit_fenced");
  }
  return {
    namespace: `release-verification/${scope.nonce}/`,
    database: {resourceKey: databaseKey, committed: true},
    r2: {
      resourceKey: r2Key,
      bytes: bytes.byteLength,
      contentDigest: await sha256(payload),
      roundTrip: true,
    },
  };
}

async function listR2Keys(
  bucket: R2BucketBinding,
  prefix: string,
): Promise<readonly string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix,
      limit: 100,
      ...(cursor ? {cursor} : {}),
    });
    keys.push(...page.objects.map(({key}) => key));
    if (keys.length > 100) {
      throw new Error("release_verification_r2_inventory_unbounded");
    }
    cursor = page.truncated ? page.cursor : undefined;
    if (page.truncated && !cursor) {
      throw new Error("release_verification_r2_inventory_cursor_missing");
    }
  } while (cursor);
  return keys.sort();
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
      ![
        "/v1/release-verification",
        "/v1/release-verification/finalize",
        "/v1/release-verification/cleanup",
      ].includes(url.pathname)
    ) {
      return notFound();
    }
    let body: unknown;
    try {
      body = await readBoundedJson(request);
    } catch {
      return notFound();
    }
    if (url.pathname === "/v1/release-verification/finalize") {
      const finalize = parseFinalizeRequest(body);
      if (!finalize) return notFound();
      const connection = createDatabaseConnection({
        mode: "hyperdrive",
        cache: "disabled",
        connectionString: bindings.HYPERDRIVE.connectionString,
        maxConnections: 1,
        connectionTimeoutMs: 5_000,
        idleTimeoutMs: 1_000,
      });
      try {
        const terminal = await createReleaseVerificationRepository(connection)
          .markTerminal({
            invocationId: finalize.invocationId,
            nonce: finalize.nonce,
            releaseId: finalize.releaseId,
            fence: finalize.fence,
            subFence: finalize.subFence,
            evidenceDigest: finalize.evidenceDigest,
            tombstoneSeconds: finalize.tombstoneSeconds,
            quiescenceSeconds: finalize.quiescenceSeconds,
          });
        return terminal
          ? Response.json({
            version: 1,
            state: "terminal",
            cleanupState: "quiescing",
            nonce: finalize.nonce,
            releaseId: finalize.releaseId,
            fence: finalize.fence,
            terminalSubFence: finalize.subFence + 1,
            tombstoneSeconds: finalize.tombstoneSeconds,
            quiescenceSeconds: finalize.quiescenceSeconds,
          }, {headers: {"Cache-Control": "no-store"}})
          : notFound();
      } finally {
        await connection.close();
      }
    }
    if (url.pathname === "/v1/release-verification/cleanup") {
      const cleanup = parseCleanupRequest(body);
      if (!cleanup) return notFound();
      const cleanupScope = {
        nonce: cleanup.nonce,
        releaseId: cleanup.releaseId,
        fence: cleanup.fence,
      };
      const connection = createDatabaseConnection({
        mode: "hyperdrive",
        cache: "disabled",
        connectionString: bindings.HYPERDRIVE.connectionString,
        maxConnections: 1,
        connectionTimeoutMs: 5_000,
        idleTimeoutMs: 1_000,
      });
      const repository = createReleaseVerificationRepository(connection);
      const prefix = `release-verification/${cleanup.nonce}/`;
      try {
        const before = await repository.cleanupInventory(cleanupScope);
        if (before?.terminal && before.cleanupState === "complete") {
          return Response.json({
            version: 1,
            state: "complete",
            cleanupState: "complete",
            nonce: cleanup.nonce,
            releaseId: cleanup.releaseId,
            fence: cleanup.fence,
            inventory: {
              prefix,
              r2Objects: 0,
              activeInvocations: before.activeInvocations,
              containerEvidence: before.containerEvidence,
              resources: before.resources,
            },
          }, {headers: {"Cache-Control": "no-store"}});
        }
        if (
          !before?.terminal ||
          !before.quiescenceReached ||
          before.activeInvocations !== 0
        ) {
          return notFound();
        }
        const expectedR2 = before.resources
          .filter(({kind, state}) => kind === "r2" && state === "committed")
          .map(({key}) => key)
          .sort();
        const actualR2 = await listR2Keys(bindings.ARTIFACTS, prefix);
        const unexpected = actualR2.filter((key) => !expectedR2.includes(key));
        const prepared = before.resources.filter(({state}) => state === "prepared");
        if (unexpected.length > 0 || prepared.length > 0) {
          const orphan = {
            prefix,
            unexpectedR2: unexpected,
            preparedResources: prepared,
            observedR2Count: actualR2.length,
          };
          await repository.markCleanupOrphaned({
            ...cleanupScope,
            inventory: orphan,
          });
          return Response.json({
            version: 1,
            state: "orphaned",
            ...orphan,
          }, {
            status: 409,
            headers: {"Cache-Control": "no-store"},
          });
        }
        if (actualR2.length > 0) {
          await bindings.ARTIFACTS.delete([...actualR2]);
        }
        for (const resourceKey of expectedR2) {
          if (!(await repository.markR2ResourceDeleted({
            ...cleanupScope,
            resourceKey,
          }))) {
            throw new Error("release_verification_r2_cleanup_fenced");
          }
        }
        if (!(await repository.cleanupDatabaseSyntheticState(cleanupScope))) {
          throw new Error("release_verification_database_cleanup_fenced");
        }
        const remainingR2 = await listR2Keys(bindings.ARTIFACTS, prefix);
        const final = await repository.cleanupInventory(cleanupScope);
        if (
          remainingR2.length !== 0 ||
          !final ||
          final.activeInvocations !== 0 ||
          final.containerEvidence !== 0 ||
          final.resources.some(({state}) => state !== "deleted")
        ) {
          const orphan = {
            prefix,
            remainingR2,
            final,
          };
          await repository.markCleanupOrphaned({
            ...cleanupScope,
            inventory: orphan,
          });
          return Response.json({
            version: 1,
            state: "orphaned",
          }, {
            status: 409,
            headers: {"Cache-Control": "no-store"},
          });
        }
        const inventory = {
          prefix,
          r2Objects: 0,
          activeInvocations: 0,
          containerEvidence: 0,
          resources: final.resources,
        };
        if (!(await repository.markCleanupComplete({
          ...cleanupScope,
          inventory,
        }))) {
          throw new Error("release_verification_cleanup_commit_fenced");
        }
        return Response.json({
          version: 1,
          state: "complete",
          cleanupState: "complete",
          nonce: cleanup.nonce,
          releaseId: cleanup.releaseId,
          fence: cleanup.fence,
          inventory,
        }, {headers: {"Cache-Control": "no-store"}});
      } finally {
        await connection.close();
      }
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
      const synthetic = await exerciseSyntheticResources(
        scope,
        bindings,
        repository,
      );
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
      const inventory = await repository.cleanupInventory(scope);
      const brokerResources = inventory?.resources.filter(
        ({kind, state}) => kind === "broker" && state === "committed",
      ) ?? [];
      if (brokerResources.length !== thumbnailSlots.length) {
        throw new Error("release_verification_broker_convergence_failed");
      }
      const completedSynthetic = {
        ...synthetic,
        broker: {
          origin: "http://shareslices-broker.internal",
          attempts: brokerResources.map(({key}) => ({
            resourceKey: key,
            committed: true,
          })),
        },
      };
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
        synthetic: completedSynthetic,
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
