import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";
import YAML from "yaml";

const publicOpenapiPath = new URL("../openapi/openapi.yaml", import.meta.url);
const privateContracts = [
  {
    openapi: new URL("../openapi/private-jobs-release-verification.yaml", import.meta.url),
    projection: new URL(
      "../../deploy/contract/private-jobs-release-verification.json",
      import.meta.url,
    ),
    origin: "http://shareslices-jobs.internal",
  },
  {
    openapi: new URL("../openapi/private-thumbnail-broker.yaml", import.meta.url),
    projection: new URL(
      "../../deploy/contract/private-thumbnail-broker.json",
      import.meta.url,
    ),
    origin: "http://shareslices-broker.internal",
  },
] as const;

describe("public and private OpenAPI ownership boundary", () => {
  it("keeps deployment-only operations out of the public HTTP contract", async () => {
    const publicOpenapi = YAML.parse(await readFile(publicOpenapiPath, "utf8")) as {
      paths: Record<string, unknown>;
      servers?: Array<{url: string}>;
    };
    const publicPaths = new Set(Object.keys(publicOpenapi.paths));

    for (const contract of privateContracts) {
      const privateOpenapi = YAML.parse(await readFile(contract.openapi, "utf8")) as {
        paths: Record<string, unknown>;
        servers: Array<{url: string}>;
      };
      const projection = JSON.parse(await readFile(contract.projection, "utf8")) as {
        origin: string;
        publicIngress: boolean;
      };

      expect(privateOpenapi.servers).toEqual([{url: contract.origin}]);
      expect(projection).toMatchObject({
        origin: contract.origin,
        publicIngress: false,
      });
      for (const path of Object.keys(privateOpenapi.paths)) {
        expect(publicPaths.has(path)).toBe(false);
      }
    }

    expect(publicOpenapi.servers ?? []).not.toContainEqual(
      expect.objectContaining({url: expect.stringContaining(".internal")}),
    );
  });
});
