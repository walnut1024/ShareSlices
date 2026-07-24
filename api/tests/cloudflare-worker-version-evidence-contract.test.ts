import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {parse} from "yaml";

const openapi = parse(readFileSync(
  new URL("../openapi/private-worker-version-evidence.yaml", import.meta.url),
  "utf8",
)) as Record<string, any>;
const deployment = JSON.parse(readFileSync(
  new URL(
    "../../deploy/contract/private-worker-version-evidence.json",
    import.meta.url,
  ),
  "utf8",
)) as Record<string, any>;

describe("private Worker version-evidence contract", () => {
  it("stays route-free, read-only, no-store, and version-metadata backed", () => {
    expect(openapi.servers.map(({url}: {url: string}) => url)).toEqual([
      "http://shareslices-app.internal",
      "http://shareslices-content.internal",
    ]);
    expect(Object.keys(openapi.paths)).toEqual(["/health"]);
    expect(Object.keys(openapi.paths["/health"])).toEqual(["get"]);
    expect(
      openapi.paths["/health"].get.responses["200"].headers["Cache-Control"]
        .schema.const,
    ).toBe("no-store");
    expect(deployment.publicIngress).toBe(false);
    expect(deployment.versionIdentitySource).toBe("CF_VERSION_METADATA");
    expect(deployment.operations).toEqual([{
      method: "GET",
      path: "/health",
      sideEffects: false,
      cache: "no-store",
    }]);
  });
});
