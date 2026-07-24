import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  record: vi.fn(async () => true),
  createDatabaseConnection: vi.fn(),
}));

vi.mock("../src/db/connection.js", () => ({
  createDatabaseConnection: mocks.createDatabaseConnection,
}));
vi.mock("../src/cloudflare/release-verification-repository.js", () => ({
  createReleaseVerificationRepository: () => ({
    recordContainerEvidence: mocks.record,
  }),
}));

import {createContainerReleaseVerificationBroker} from "../src/cloudflare/container-release-verification-broker.js";

const bindings = {
  HYPERDRIVE: {connectionString: "postgres://binding"},
};
const evidence = {
  version: 1,
  nonce: "nonce-012345678901",
  releaseId: "release-1",
  fence: 7,
  subFence: 3,
  containerClass: "thumbnail",
  stableSlot: "thumbnail-slot-1",
  providerInstance: "provider-deployment-1",
  buildIdentity: "sha256:thumbnail",
  contractRevision: "gallery-job/v1",
  imageReference: "registry.example/thumbnail@sha256:image",
};

describe("Cloudflare Container release-verification broker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDatabaseConnection.mockReturnValue({close: mocks.close});
    mocks.record.mockResolvedValue(true);
  });

  it("records one trusted controller-bound provider identity", async () => {
    const response = await createContainerReleaseVerificationBroker()(
      new Request(
        "http://shareslices-release-verifier.internal/v1/container-evidence",
        {method: "POST", body: JSON.stringify(evidence)},
      ),
      bindings,
      "controller-instance-1",
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.record).toHaveBeenCalledWith({
      ...evidence,
      controllerInstance: "controller-instance-1",
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("conceals public, oversized, malformed, and stale evidence", async () => {
    const broker = createContainerReleaseVerificationBroker();
    expect((await broker(new Request(
      "https://public.example/v1/container-evidence",
      {method: "POST", body: JSON.stringify(evidence)},
    ), bindings, "controller-instance-1")).status).toBe(404);
    expect((await broker(new Request(
      "http://shareslices-release-verifier.internal/v1/container-evidence",
      {
        method: "POST",
        headers: {"content-length": "8193"},
        body: JSON.stringify(evidence),
      },
    ), bindings, "controller-instance-1")).status).toBe(404);
    expect(mocks.createDatabaseConnection).not.toHaveBeenCalled();

    mocks.record.mockResolvedValue(false);
    expect((await broker(new Request(
      "http://shareslices-release-verifier.internal/v1/container-evidence",
      {method: "POST", body: JSON.stringify(evidence)},
    ), bindings, "controller-instance-1")).status).toBe(404);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
