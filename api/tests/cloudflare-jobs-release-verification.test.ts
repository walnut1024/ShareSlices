import {beforeEach, describe, expect, it, vi} from "vitest";
import type {
  RecordedReleaseVerificationContainerEvidence,
  ReleaseVerificationBegin,
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
  }),
}));

import {createJobsReleaseVerificationFetch} from "../src/cloudflare/jobs-release-verification.js";

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
};

describe("route-free Jobs release verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDatabaseConnection.mockReturnValue({
      close: mocks.close,
    });
    mocks.begin.mockResolvedValue({
      state: "started",
      migrationHead: "0038_cloudflare_release_verification_probe",
    });
    mocks.complete.mockResolvedValue(true);
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
