import {beforeEach, describe, expect, it, vi} from "vitest";
import type {ReleaseVerificationBegin} from "../src/cloudflare/release-verification-repository.js";

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  begin: vi.fn<() => Promise<ReleaseVerificationBegin | null>>(async () => ({
    state: "started",
    migrationHead: "0038_cloudflare_release_verification_probe",
  })),
  complete: vi.fn(async () => true),
  fail: vi.fn(async () => undefined),
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
      containerConvergence: "unverified",
    });
    expect(mocks.begin).toHaveBeenCalledWith(probe, 60);
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
