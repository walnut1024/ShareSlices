import {beforeEach, describe, expect, it, vi} from "vitest";

const lifecycle = vi.hoisted(() => ({
  starts: [] as unknown[],
  stops: [] as unknown[],
}));

vi.mock("@cloudflare/containers", () => ({
  Container: class {
    envVars: Record<string, string> = {};
    sleepAfter: string | number = "10m";

    async start(options: unknown) {
      lifecycle.starts.push(options);
    }

    async stop(signal: unknown) {
      lifecycle.stops.push(signal);
    }
  },
  ContainerProxy: class {},
}));

import {
  TrustedProcessingContainer,
  containerDrainEntrypoint,
} from "../src/cloudflare/container-classes.js";

const bindings = {
  TRUSTED_PROCESSING_SLEEP_AFTER_SECONDS: "60",
  THUMBNAIL_SLEEP_AFTER_SECONDS: "30",
  TRUSTED_PROCESSING_MAXIMUM_CLAIMS_PER_DRAIN: "8",
  THUMBNAIL_MAXIMUM_CLAIMS_PER_DRAIN: "2",
  TRUSTED_PROCESSING_MAXIMUM_WALL_TIME_SECONDS: "600",
  THUMBNAIL_MAXIMUM_WALL_TIME_SECONDS: "300",
  TRUSTED_PROCESSING_IMAGE_BUILD_IDENTITY: "processing-build",
  THUMBNAIL_IMAGE_BUILD_IDENTITY: "thumbnail-build",
  CONTAINER_RELEASE_ID: "release-1",
  CONTAINER_CONTRACT_REVISION: "contract-v1",
};

describe("Cloudflare Container lifecycle", () => {
  beforeEach(() => {
    lifecycle.starts.length = 0;
    lifecycle.stops.length = 0;
  });

  it("starts an explicitly bounded one-shot drain instead of forwarding a wake", async () => {
    const container = new TrustedProcessingContainer(
      {} as never,
      bindings as never,
    );

    const response = await container.fetch(new Request(
      "https://container.invalid/internal/wake",
      {method: "POST"},
    ));

    expect(response.status).toBe(202);
    expect(lifecycle.starts).toEqual([{
      enableInternet: false,
      entrypoint: [
        "shareslices-worker",
        "drain",
        "--lanes",
        "artifact-processing",
        "--maximum-claims",
        "8",
        "--maximum-idle-observations",
        "1",
        "--wall-time-seconds",
        "600",
      ],
      envVars: expect.objectContaining({
        SHARESLICES_CONTAINER_BUILD_IDENTITY: "processing-build",
        SHARESLICES_CONTAINER_RELEASE_ID: "release-1",
      }),
    }]);
    expect(container.sleepAfter).toBe(60_000);
  });

  it("stops idle work with SIGTERM and restarts only for durable remaining work", async () => {
    const container = new TrustedProcessingContainer(
      {} as never,
      bindings as never,
    );
    await container.onActivityExpired();
    await container.onStop({exitCode: 75, reason: "exit"});
    await container.onStop({exitCode: 0, reason: "exit"});
    await container.onStop({exitCode: 75, reason: "runtime_signal"});

    expect(lifecycle.stops).toEqual(["SIGTERM"]);
    expect(lifecycle.starts).toHaveLength(1);
  });

  it("rejects invalid bounds and exposes no proxy route", async () => {
    expect(() => containerDrainEntrypoint({
      lane: "thumbnail",
      maximumClaims: "0",
      maximumWallTimeSeconds: "300",
    })).toThrow("invalid_cloudflare_binding_maximum_claims_per_drain");
    const container = new TrustedProcessingContainer(
      {} as never,
      bindings as never,
    );
    expect((await container.fetch(new Request(
      "https://container.invalid/ssh",
    ))).status).toBe(404);
    expect(lifecycle.starts).toHaveLength(0);
  });
});
