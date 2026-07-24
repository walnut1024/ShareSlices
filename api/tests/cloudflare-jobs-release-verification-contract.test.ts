import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";
import YAML from "yaml";

const openapiPath = new URL(
  "../openapi/private-jobs-release-verification.yaml",
  import.meta.url,
);
const projectionPath = new URL(
  "../../deploy/contract/private-jobs-release-verification.json",
  import.meta.url,
);

describe("private Jobs release-verification wire contract", () => {
  it("projects one route-free fetch Service Binding operation", async () => {
    const openapi = YAML.parse(await readFile(openapiPath, "utf8"));
    const projection = JSON.parse(await readFile(projectionPath, "utf8"));

    expect(openapi.servers).toEqual([
      {url: "http://shareslices-jobs.internal"},
    ]);
    expect(Object.keys(openapi.paths)).toEqual([
      "/v1/release-verification",
      "/v1/release-verification/finalize",
      "/v1/release-verification/cleanup",
    ]);
    expect(projection).toMatchObject({
      origin: "http://shareslices-jobs.internal",
      publicIngress: false,
      callerBinding: "JOBS_RELEASE_VERIFICATION",
      transport: "fetch-service-binding",
      terminalNonceRequired: true,
      activeInvocationLeaseRequired: true,
      entryWorkerVersionEvidenceRequired: true,
      containerConvergenceRequiredForAcceptance: true,
    });
    expect(projection.operations).toEqual([
      {
        method: "POST",
        path: "/v1/release-verification",
        scope: ["releaseId", "fence", "nonce", "subFence", "entryWorkers"],
      },
      {
        method: "POST",
        path: "/v1/release-verification/finalize",
        scope: [
          "releaseId",
          "fence",
          "nonce",
          "subFence",
          "evidenceDigest",
        ],
      },
      {
        method: "POST",
        path: "/v1/release-verification/cleanup",
        scope: ["releaseId", "fence", "nonce"],
      },
    ]);
  });

  it("requires actual identity and explicit Container convergence evidence", async () => {
    const openapi = YAML.parse(await readFile(openapiPath, "utf8"));
    const evidence = openapi.components.schemas.Evidence;
    expect(evidence.required).toEqual(expect.arrayContaining([
      "jobsWorker",
      "entryWorkers",
      "migrationHead",
      "database",
      "broker",
      "synthetic",
      "configuredContainerImages",
      "containers",
      "containerConvergence",
    ]));
    expect(evidence.properties.containerConvergence.const).toBe("verified");
    expect(evidence.properties.containers.items.required).toEqual(
      expect.arrayContaining([
        "providerInstance",
        "controllerInstance",
        "buildIdentity",
        "imageReference",
        "stableSlot",
      ]),
    );
  });
});
