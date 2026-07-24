import {createHash} from "node:crypto";
import {describe, expect, it, vi} from "vitest";

import {createCloudflareReleaseVerifier} from "../src/cloudflare/release-verifier-entrypoint.js";

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

const scope = {
  invocationId: "invocation-0123456789",
  nonce: "nonce-012345678901",
  releaseId: `sha256:${"a".repeat(64)}`,
  fence: 7,
  subFence: 3,
};
const containers = [
  {
    containerClass: "trusted-processing",
    stableSlot: "processing-slot-1",
    providerInstance: "provider-processing-1",
    buildIdentity: "build-processing",
    contractRevision: "gallery-job/v1",
    imageReference: "registry.example/processing@sha256:image",
  },
  {
    containerClass: "thumbnail",
    stableSlot: "thumbnail-slot-1",
    providerInstance: "provider-thumbnail-1",
    buildIdentity: "build-thumbnail",
    contractRevision: "gallery-job/v1",
    imageReference: "registry.example/thumbnail@sha256:image",
  },
];
const expected = {
  appWorker: {
    name: "shareslices-app",
    versionId: "app-version-1",
  },
  contentWorker: {
    name: "shareslices-content",
    versionId: "content-version-1",
  },
  jobsWorker: {
    versionId: "jobs-version-1",
    releaseBundleIdentity: `sha256:${"b".repeat(64)}`,
    configurationDigest: `sha256:${"c".repeat(64)}`,
    exportsDigest: `sha256:${"d".repeat(64)}`,
  },
  migrationHead: "0042_cloudflare_release_verification_terminal_invocation.sql",
  configuredContainerImages: {
    trustedProcessing: "registry.example/processing@sha256:image",
    thumbnail: "registry.example/thumbnail@sha256:image",
  },
  containers,
};
const lifecycle = {
  tombstoneSeconds: 345_660,
  quiescenceSeconds: 660,
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
    ...expected.jobsWorker,
    versionTimestamp: "2026-07-24T00:00:00.000Z",
  },
  entryWorkers: {
    application: expected.appWorker,
    content: expected.contentWorker,
  },
  migrationHead: expected.migrationHead,
  database: {mode: "hyperdrive", reachable: true},
  broker: {
    origin: "http://shareslices-broker.internal",
    publicIngress: false,
  },
  configuredContainerImages: expected.configuredContainerImages,
  containers: containers.map((container) => ({
    ...container,
    nonce: scope.nonce,
    releaseId: scope.releaseId,
    fence: scope.fence,
    subFence: scope.subFence,
    controllerInstance: `controller-${container.stableSlot}`,
    observedAt: "2026-07-24T00:00:00.000Z",
  })),
  containerConvergence: "verified",
};

function fixture(overrides: Record<string, unknown> = {}) {
  const ack = vi.fn();
  const sleep = vi.fn(async () => undefined);
  const serialized = canonicalJson(evidence);
  const evidenceDigest =
    `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
  const fetch = vi.fn(async (request: Request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname.endsWith("/cleanup")) {
      return Response.json({
        version: 1,
        state: "complete",
        cleanupState: "complete",
        nonce: scope.nonce,
        releaseId: scope.releaseId,
        fence: scope.fence,
      });
    }
    return pathname.endsWith("/finalize")
      ? Response.json({
        version: 1,
        state: "terminal",
        cleanupState: "quiescing",
        nonce: scope.nonce,
        releaseId: scope.releaseId,
        fence: scope.fence,
        terminalSubFence: scope.subFence + 1,
        ...lifecycle,
      })
      : new Response(serialized, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-shareslices-evidence-digest": evidenceDigest,
        },
      });
  });
  const appFetch = vi.fn(async (request: Request) => {
    expect(request.headers.get("cloudflare-workers-version-overrides")).toBe(
      'shareslices-app="app-version-1"',
    );
    return Response.json(
      {version: 1, versionId: expected.appWorker.versionId},
      {headers: {"Cache-Control": "no-store"}},
    );
  });
  const contentFetch = vi.fn(async (request: Request) => {
    expect(request.headers.get("cloudflare-workers-version-overrides")).toBe(
      'shareslices-content="content-version-1"',
    );
    return Response.json(
      {version: 1, versionId: expected.contentWorker.versionId},
      {headers: {"Cache-Control": "no-store"}},
    );
  });
  const batch = {
    queue: "installation-verify-release-7",
    messages: [{
      id: "message-1",
      timestamp: new Date(),
      attempts: 1,
      body: {
        version: 1,
        ...scope,
        lifecycle,
        expected,
        ...overrides,
      },
      ack,
      retry: vi.fn(),
    }],
    metadata: {metrics: {backlogCount: 1, backlogBytes: 1}},
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
  return {ack, batch, fetch, appFetch, contentFetch, sleep};
}

function bindings(value: ReturnType<typeof fixture>) {
  return {
    APP_RELEASE_VERIFICATION: {fetch: value.appFetch},
    CONTENT_RELEASE_VERIFICATION: {fetch: value.contentFetch},
    JOBS_RELEASE_VERIFICATION: {fetch: value.fetch},
    VERIFIER_QUEUE_NAME: value.batch.queue,
  };
}

describe("Cloudflare release-only verifier entrypoint", () => {
  it("calls Jobs only through its explicit Service Binding and acknowledges exact evidence", async () => {
    const value = fixture();
    const {ack, batch, fetch, sleep} = value;

    await createCloudflareReleaseVerifier({sleep}).queue(
      batch,
      bindings(value),
      {
        props: undefined,
        waitUntil() {},
        passThroughOnException() {},
      },
    );

    expect(fetch).toHaveBeenCalledTimes(3);
    const request = fetch.mock.calls[0]![0] as Request;
    expect(request.url).toBe(
      "http://shareslices-jobs.internal/v1/release-verification",
    );
    expect(await request.json()).toEqual({
      version: 1,
      ...scope,
      entryWorkers: evidence.entryWorkers,
    });
    const finalize = fetch.mock.calls[1]![0] as Request;
    expect(finalize.url).toBe(
      "http://shareslices-jobs.internal/v1/release-verification/finalize",
    );
    expect(await finalize.json()).toEqual({
      version: 1,
      ...scope,
      evidenceDigest:
        `sha256:${createHash("sha256").update(canonicalJson(evidence)).digest("hex")}`,
      ...lifecycle,
    });
    expect(sleep).toHaveBeenCalledWith(660_000);
    const cleanup = fetch.mock.calls[2]![0] as Request;
    expect(cleanup.url).toBe(
      "http://shareslices-jobs.internal/v1/release-verification/cleanup",
    );
    expect(await cleanup.json()).toEqual({
      version: 1,
      nonce: scope.nonce,
      releaseId: scope.releaseId,
      fence: scope.fence,
    });
    expect(ack).toHaveBeenCalledOnce();
  });

  it("leaves malformed, wrong-queue, digest-mismatched, and identity-mismatched work unacknowledged", async () => {
    const verifier = createCloudflareReleaseVerifier();
    const context = {
      props: undefined,
      waitUntil() {},
      passThroughOnException() {},
    };
    const malformed = fixture({nonce: "short"});
    await expect(verifier.queue(
      malformed.batch,
      bindings(malformed),
      context,
    )).rejects.toThrow("release_verifier_message_invalid");
    expect(malformed.ack).not.toHaveBeenCalled();

    const wrongAppVersion = fixture();
    wrongAppVersion.appFetch.mockResolvedValueOnce(Response.json(
      {version: 1, versionId: "previous-app-version"},
      {headers: {"Cache-Control": "no-store"}},
    ));
    await expect(verifier.queue(
      wrongAppVersion.batch,
      bindings(wrongAppVersion),
      context,
    )).rejects.toThrow("release_verifier_version_override_mismatch");
    expect(wrongAppVersion.fetch).not.toHaveBeenCalled();
    expect(wrongAppVersion.ack).not.toHaveBeenCalled();

    const mismatched = fixture();
    mismatched.fetch.mockImplementationOnce(async () => {
      const body = canonicalJson({
        ...evidence,
        migrationHead: "wrong-migration",
      });
      return new Response(body, {
        status: 200,
        headers: {
          "x-shareslices-evidence-digest":
            `sha256:${createHash("sha256").update(body).digest("hex")}`,
        },
      });
    });
    await expect(verifier.queue(
      mismatched.batch,
      bindings(mismatched),
      context,
    )).rejects.toThrow("release_verifier_evidence_mismatch");
    expect(mismatched.ack).not.toHaveBeenCalled();

    const wrongQueue = fixture();
    await expect(verifier.queue(
      {...wrongQueue.batch, queue: "production-jobs"},
      bindings(wrongQueue),
      context,
    )).rejects.toThrow("release_verifier_queue_scope_invalid");
    expect(wrongQueue.fetch).not.toHaveBeenCalled();

    const unbounded = fixture({
      lifecycle: {tombstoneSeconds: 1_000, quiescenceSeconds: 661},
    });
    await expect(verifier.queue(
      unbounded.batch,
      bindings(unbounded),
      context,
    )).rejects.toThrow("release_verifier_message_invalid");
    expect(unbounded.fetch).not.toHaveBeenCalled();
  });

  it("executes final cleanup only through the same private Jobs binding", async () => {
    const ack = vi.fn();
    const body = {
      version: 1,
      operation: "cleanup",
      nonce: scope.nonce,
      releaseId: scope.releaseId,
      fence: scope.fence,
    } as const;
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        "http://shareslices-jobs.internal/v1/release-verification/cleanup",
      );
      expect(await request.json()).toEqual({
        version: 1,
        nonce: scope.nonce,
        releaseId: scope.releaseId,
        fence: scope.fence,
      });
      return Response.json({
        version: 1,
        state: "complete",
        cleanupState: "complete",
        nonce: scope.nonce,
        releaseId: scope.releaseId,
        fence: scope.fence,
      });
    });
    const batch = {
      queue: "installation-verify-release-7",
      messages: [{
        id: "cleanup-message",
        timestamp: new Date(),
        attempts: 1,
        body,
        ack,
        retry: vi.fn(),
      }],
      metadata: {metrics: {backlogCount: 1, backlogBytes: 1}},
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    };

    await createCloudflareReleaseVerifier().queue(
      batch,
      {
        APP_RELEASE_VERIFICATION: {fetch},
        CONTENT_RELEASE_VERIFICATION: {fetch},
        JOBS_RELEASE_VERIFICATION: {fetch},
        VERIFIER_QUEUE_NAME: batch.queue,
      },
      {
        props: undefined,
        waitUntil() {},
        passThroughOnException() {},
      },
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(ack).toHaveBeenCalledOnce();
  });

  it("does not acknowledge a terminal nonce until quiescence cleanup succeeds", async () => {
    const value = fixture();
    const {ack, batch, fetch, sleep} = value;
    fetch.mockImplementationOnce(async () => {
      const serialized = canonicalJson(evidence);
      return new Response(serialized, {
        status: 200,
        headers: {
          "x-shareslices-evidence-digest":
            `sha256:${createHash("sha256").update(serialized).digest("hex")}`,
        },
      });
    });
    fetch.mockImplementationOnce(async () => Response.json({
      version: 1,
      state: "terminal",
      cleanupState: "quiescing",
      nonce: scope.nonce,
      releaseId: scope.releaseId,
      fence: scope.fence,
      terminalSubFence: scope.subFence + 1,
      ...lifecycle,
    }));
    fetch.mockImplementationOnce(async () => new Response(null, {status: 409}));

    await expect(createCloudflareReleaseVerifier({sleep}).queue(
      batch,
      bindings(value),
      {
        props: undefined,
        waitUntil() {},
        passThroughOnException() {},
      },
    )).rejects.toThrow("release_verifier_cleanup_rejected");

    expect(sleep).toHaveBeenCalledWith(660_000);
    expect(ack).not.toHaveBeenCalled();
  });

  it("exports Queue authority only and no public fetch or scheduled handler", () => {
    expect(Object.keys(createCloudflareReleaseVerifier())).toEqual(["queue"]);
  });
});
