import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";
import YAML from "yaml";

const openapiPath = new URL(
  "../openapi/private-container-release-verification.yaml",
  import.meta.url,
);
const projectionPath = new URL(
  "../../deploy/contract/private-container-release-verification.json",
  import.meta.url,
);

describe("private Container release-verification callback contract", () => {
  it("projects one secretless route with two independent platform identities", async () => {
    const openapi = YAML.parse(await readFile(openapiPath, "utf8"));
    const projection = JSON.parse(await readFile(projectionPath, "utf8"));

    expect(openapi.servers).toEqual([
      {url: "http://shareslices-release-verifier.internal"},
    ]);
    expect(Object.keys(openapi.paths)).toEqual(["/v1/container-evidence"]);
    expect(projection).toMatchObject({
      publicIngress: false,
      transport: "container-outbound-handler",
      providerIdentitySource: "CLOUDFLARE_DEPLOYMENT_ID",
      controllerIdentitySource: "outbound-handler-context.containerId",
      terminalNonceRequired: true,
      expectedIdentityMatchRequired: true,
    });
    expect(projection.operations[0].scope).toEqual([
      "releaseId",
      "fence",
      "nonce",
      "subFence",
      "containerClass",
      "stableSlot",
    ]);
  });
});
