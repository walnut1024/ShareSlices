import {beforeEach, describe, expect, it, vi} from "vitest";
import type {
  RecordedReleaseVerificationContainerEvidence,
  ReleaseVerificationBegin,
  ReleaseVerificationCleanupInventory,
} from "../src/cloudflare/release-verification-repository.js";

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  begin: vi.fn<() => Promise<ReleaseVerificationBegin | null>>(async () => ({
    state: "started",
    migrationHead: "0038_cloudflare_release_verification_probe",
  })),
  complete: vi.fn(async () => true),
  fail: vi.fn(async () => undefined),
  listContainerEvidence: vi.fn<
    () => Promise<readonly RecordedReleaseVerificationContainerEvidence[]>
  >(async () => []),
  prepareSyntheticResource: vi.fn(async () => true),
  commitSyntheticResource: vi.fn(async () => true),
  markTerminal: vi.fn(async () => true),
  cleanupInventory: vi.fn<
    () => Promise<ReleaseVerificationCleanupInventory | null>
  >(async () => null),
  markCleanupOrphaned: vi.fn(async () => true),
  markR2ResourceDeleted: vi.fn(async () => true),
  cleanupDatabaseSyntheticState: vi.fn(async () => true),
  markCleanupComplete: vi.fn(async () => true),
  createDatabaseConnection: vi.fn(),
}));

vi.mock("../src/db/connection.js", () => ({
  createDatabaseConnection: mocks.createDatabaseConnection,
}));
vi.mock("../src/cloudflare/release-verification-repository.js", () => ({
  createReleaseVerificationRepository: () => ({
    begin: mocks.begin,
    complete: mocks.complete,
    fail: mocks.fail,
    listContainerEvidence: mocks.listContainerEvidence,
    prepareSyntheticResource: mocks.prepareSyntheticResource,
    commitSyntheticResource: mocks.commitSyntheticResource,
    markTerminal: mocks.markTerminal,
    cleanupInventory: mocks.cleanupInventory,
    markCleanupOrphaned: mocks.markCleanupOrphaned,
    markR2ResourceDeleted: mocks.markR2ResourceDeleted,
    cleanupDatabaseSyntheticState: mocks.cleanupDatabaseSyntheticState,
    markCleanupComplete: mocks.markCleanupComplete,
  }),
}));

import {createJobsReleaseVerificationFetch} from "../src/cloudflare/jobs-release-verification.js";

const r2Objects = new Map<string, Uint8Array>();
const bindings = {
  HYPERDRIVE: {connectionString: "postgres://binding"},
  CF_VERSION_METADATA: {
    id: "jobs-version-1",
    tag: "release-candidate",
    timestamp: "2026-07-24T00:00:00.000Z",
  },
  JOBS_RELEASE_BUNDLE_IDENTITY: `sha256:${"a".repeat(64)}`,
  JOBS_CONFIGURATION_DIGEST: `sha256:${"b".repeat(64)}`,
  JOBS_EXPORTS_DIGEST: `sha256:${"c".repeat(64)}`,
  TRUSTED_PROCESSING_IMAGE_REFERENCE: "registry.example/processing:release-a",
  THUMBNAIL_IMAGE_REFERENCE: "registry.example/thumbnail:release-a",
  RELEASE_VERIFICATION_INVOCATION_LEASE_SECONDS: "60",
  RELEASE_VERIFICATION_CONTAINER_WAIT_SECONDS: "45",
  TRUSTED_PROCESSING_STABLE_SLOTS: JSON.stringify(["processing-slot-1"]),
  THUMBNAIL_STABLE_SLOTS: JSON.stringify(["thumbnail-slot-1"]),
  TRUSTED_PROCESSING_CONTAINERS: {
    idFromName: vi.fn((slot: string) => slot),
    get: vi.fn(() => ({
      fetch: vi.fn(async () => new Response(null, {status: 202})),
    })),
  },
  THUMBNAIL_CONTAINERS: {
    idFromName: vi.fn((slot: string) => slot),
    get: vi.fn(() => ({
      fetch: vi.fn(async () => new Response(null, {status: 202})),
    })),
  },
  ARTIFACTS: {
    async put(key: string, stream: ReadableStream<Uint8Array>) {
      r2Objects.set(
        key,
        new Uint8Array(await new Response(stream).arrayBuffer()),
      );
      return {key, size: r2Objects.get(key)!.byteLength, uploaded: new Date()};
    },
    async get(key: string) {
      const bytes = r2Objects.get(key);
      return bytes
        ? {
          key,
          size: bytes.byteLength,
          uploaded: new Date(),
          body: new Response(bytes.slice().buffer as ArrayBuffer).body!,
        }
        : null;
    },
    async delete(key: string | string[]) {
      for (const entry of Array.isArray(key) ? key : [key]) {
        r2Objects.delete(entry);
      }
    },
    async list({prefix}: {prefix: string}) {
      return {
        objects: [...r2Objects.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({
            key,
            size: value.byteLength,
            uploaded: new Date(),
          })),
        truncated: false,
      };
    },
    async createMultipartUpload() {
      throw new Error("not_used");
    },
  },
};
const context = {
  props: undefined,
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
};
const probe = {
  version: 1,
  invocationId: "invocation-0123456789",
  nonce: "nonce-012345678901",
  releaseId: "release-1",
  fence: 7,
  subFence: 3,
  entryWorkers: {
    application: {name: "shareslices-app", versionId: "app-version-1"},
    content: {name: "shareslices-content", versionId: "content-version-1"},
  },
};

describe("route-free Jobs release verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    r2Objects.clear();
    mocks.createDatabaseConnection.mockReturnValue({
      close: mocks.close,
    });
    mocks.begin.mockResolvedValue({
      state: "started",
      migrationHead: "0038_cloudflare_release_verification_probe",
    });
    mocks.complete.mockResolvedValue(true);
    mocks.markTerminal.mockResolvedValue(true);
    mocks.cleanupInventory.mockResolvedValue({
      terminal: false,
      quiescenceReached: false,
      activeInvocations: 1,
      containerEvidence: 2,
      resources: [{
        kind: "broker",
        key: `release-verification/${probe.nonce}/broker/thumbnail/provider`,
        state: "committed",
      }],
      cleanupState: "not_started",
    });
    mocks.markCleanupOrphaned.mockResolvedValue(true);
    mocks.markR2ResourceDeleted.mockResolvedValue(true);
    mocks.cleanupDatabaseSyntheticState.mockResolvedValue(true);
    mocks.markCleanupComplete.mockResolvedValue(true);
    mocks.listContainerEvidence.mockResolvedValue([
      {
        nonce: probe.nonce,
        releaseId: probe.releaseId,
        fence: probe.fence,
        subFence: probe.subFence,
        containerClass: "thumbnail",
        stableSlot: "thumbnail-slot-1",
        providerInstance: "thumbnail-provider-1",
        controllerInstance: "thumbnail-controller-1",
        buildIdentity: "thumbnail-build",
        contractRevision: "gallery-job/v1",
        imageReference: bindings.THUMBNAIL_IMAGE_REFERENCE,
        observedAt: "2026-07-24T00:00:00.000Z",
      },
      {
        nonce: probe.nonce,
        releaseId: probe.releaseId,
        fence: probe.fence,
        subFence: probe.subFence,
        containerClass: "trusted-processing",
        stableSlot: "processing-slot-1",
        providerInstance: "processing-provider-1",
        controllerInstance: "processing-controller-1",
        buildIdentity: "processing-build",
        contractRevision: "gallery-job/v1",
        imageReference: bindings.TRUSTED_PROCESSING_IMAGE_REFERENCE,
        observedAt: "2026-07-24T00:00:00.000Z",
      },
    ]);
  });

  it("returns executing Worker and configured release identities after fenced commit", async () => {
    const fetch = createJobsReleaseVerificationFetch();
    const response = await fetch(new Request(
      "http://shareslices-jobs.internal/v1/release-verification",
      {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(probe),
      },
    ), bindings, context);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-shareslices-evidence-digest")).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    await expect(response.json()).resolves.toMatchObject({
      scope: {
        nonce: probe.nonce,
        releaseId: probe.releaseId,
        fence: probe.fence,
        subFence: probe.subFence,
      },
      jobsWorker: {
        versionId: "jobs-version-1",
        versionTag: "release-candidate",
        releaseBundleIdentity: bindings.JOBS_RELEASE_BUNDLE_IDENTITY,
        configurationDigest: bindings.JOBS_CONFIGURATION_DIGEST,
        exportsDigest: bindings.JOBS_EXPORTS_DIGEST,
      },
      entryWorkers: probe.entryWorkers,
      migrationHead: "0038_cloudflare_release_verification_probe",
      database: {mode: "hyperdrive", reachable: true},
      broker: {
        origin: "http://shareslices-broker.internal",
        publicIngress: false,
      },
      containerConvergence: "verified",
    });
    expect(mocks.begin).toHaveBeenCalledWith(probe, 60);
    expect(mocks.listContainerEvidence).toHaveBeenCalledWith(probe);
    expect(mocks.prepareSyntheticResource).toHaveBeenCalledTimes(2);
    expect(mocks.commitSyntheticResource).toHaveBeenCalledTimes(2);
    expect(mocks.complete).toHaveBeenCalledWith(
      probe,
      response.headers.get("x-shareslices-evidence-digest"),
      expect.objectContaining({migrationHead: "0038_cloudflare_release_verification_probe"}),
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("replays persisted evidence without executing or recommitting the probe", async () => {
    const persisted = {
      version: 1,
      scope: {
        nonce: probe.nonce,
        releaseId: probe.releaseId,
        fence: probe.fence,
        subFence: probe.subFence,
      },
      migrationHead: "0038_cloudflare_release_verification_probe",
    };
    const digest = `sha256:${"d".repeat(64)}`;
    mocks.begin.mockResolvedValueOnce({
      state: "completed",
      evidence: persisted,
      evidenceDigest: digest,
    });

    const response = await createJobsReleaseVerificationFetch()(new Request(
      "http://shareslices-jobs.internal/v1/release-verification",
      {method: "POST", body: JSON.stringify(probe)},
    ), bindings, context);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-shareslices-evidence-digest")).toBe(digest);
    await expect(response.json()).resolves.toEqual(persisted);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("atomically makes one exact evidence digest terminal without extending replay", async () => {
    const evidenceDigest = `sha256:${"e".repeat(64)}`;
    const request = () => new Request(
      "http://shareslices-jobs.internal/v1/release-verification/finalize",
      {
        method: "POST",
        body: JSON.stringify({
          version: probe.version,
          invocationId: probe.invocationId,
          nonce: probe.nonce,
          releaseId: probe.releaseId,
          fence: probe.fence,
          subFence: probe.subFence,
          evidenceDigest,
          tombstoneSeconds: 345_660,
          quiescenceSeconds: 660,
        }),
      },
    );

    const response = await createJobsReleaseVerificationFetch()(
      request(),
      bindings,
      context,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: "terminal",
      cleanupState: "quiescing",
      nonce: probe.nonce,
      terminalSubFence: probe.subFence + 1,
      tombstoneSeconds: 345_660,
      quiescenceSeconds: 660,
    });
    expect(mocks.markTerminal).toHaveBeenCalledWith({
      invocationId: probe.invocationId,
      nonce: probe.nonce,
      releaseId: probe.releaseId,
      fence: probe.fence,
      subFence: probe.subFence,
      evidenceDigest,
      tombstoneSeconds: 345_660,
      quiescenceSeconds: 660,
    });

    mocks.markTerminal.mockResolvedValueOnce(false);
    expect((await createJobsReleaseVerificationFetch()(
      request(),
      bindings,
      context,
    )).status).toBe(404);
  });

  it("cleans only inventoried nonce-owned R2 and database state after quiescence", async () => {
    const r2Key =
      `release-verification/${probe.nonce}/r2/${probe.invocationId}.json`;
    r2Objects.set(r2Key, new TextEncoder().encode("{}"));
    const committed = [
      {
        kind: "database" as const,
        key: `release-verification/${probe.nonce}/database/jobs-worker`,
        state: "committed" as const,
      },
      {
        kind: "broker" as const,
        key: `release-verification/${probe.nonce}/broker/private-execution`,
        state: "committed" as const,
      },
      {kind: "r2" as const, key: r2Key, state: "committed" as const},
    ];
    const deleted = committed.map((resource) => ({
      ...resource,
      state: "deleted" as const,
    }));
    mocks.cleanupInventory
      .mockResolvedValueOnce({
        terminal: true,
        quiescenceReached: true,
        activeInvocations: 0,
        containerEvidence: 2,
        resources: committed,
        cleanupState: "quiescing",
      })
      .mockResolvedValueOnce({
        terminal: true,
        quiescenceReached: true,
        activeInvocations: 0,
        containerEvidence: 0,
        resources: deleted,
        cleanupState: "quiescing",
      });
    const request = new Request(
      "http://shareslices-jobs.internal/v1/release-verification/cleanup",
      {
        method: "POST",
        body: JSON.stringify({
          version: 1,
          nonce: probe.nonce,
          releaseId: probe.releaseId,
          fence: probe.fence,
        }),
      },
    );

    const response = await createJobsReleaseVerificationFetch()(
      request,
      bindings,
      context,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: "complete",
      cleanupState: "complete",
      inventory: {r2Objects: 0, activeInvocations: 0},
    });
    expect(r2Objects.has(r2Key)).toBe(false);
    expect(mocks.markR2ResourceDeleted).toHaveBeenCalledWith({
      nonce: probe.nonce,
      releaseId: probe.releaseId,
      fence: probe.fence,
      resourceKey: r2Key,
    });
    expect(mocks.cleanupDatabaseSyntheticState).toHaveBeenCalledOnce();
    expect(mocks.markCleanupComplete).toHaveBeenCalledOnce();
  });

  it("rejects oversized bodies before opening Hyperdrive", async () => {
    const response = await createJobsReleaseVerificationFetch()(new Request(
      "http://shareslices-jobs.internal/v1/release-verification",
      {
        method: "POST",
        headers: {"content-length": "16385"},
        body: JSON.stringify(probe),
      },
    ), bindings, context);

    expect(response.status).toBe(404);
    expect(mocks.createDatabaseConnection).not.toHaveBeenCalled();
  });

  it("rejects public, malformed, and stale-scope callers without evidence", async () => {
    const fetch = createJobsReleaseVerificationFetch();
    expect((await fetch(new Request(
      "https://jobs.example.test/v1/release-verification",
      {method: "POST", body: JSON.stringify(probe)},
    ), bindings, context)).status).toBe(404);
    expect(mocks.createDatabaseConnection).not.toHaveBeenCalled();

    mocks.begin.mockResolvedValue(null);
    expect((await fetch(new Request(
      "http://shareslices-jobs.internal/v1/release-verification",
      {method: "POST", body: JSON.stringify(probe)},
    ), bindings, context)).status).toBe(404);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
