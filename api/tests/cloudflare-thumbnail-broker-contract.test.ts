import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {parse} from "yaml";

const contract = parse(readFileSync(
  new URL("../openapi/private-thumbnail-broker.yaml", import.meta.url),
  "utf8",
)) as {
  servers: Array<{url: string}>;
  paths: Record<string, Record<string, {operationId: string}>>;
  components: {schemas: {Bootstrap: {properties: Record<string, unknown>}}};
};
const projection = JSON.parse(readFileSync(
  new URL("../../deploy/contract/private-thumbnail-broker.json", import.meta.url),
  "utf8",
)) as {
  origin: string;
  publicIngress: boolean;
  operations: Array<{method: string; path: string}>;
  fixedRendererContract: Record<string, unknown>;
};

describe("private thumbnail broker wire contract", () => {
  it("keeps the deployment projection synchronized with the private OpenAPI paths", () => {
    const operations = Object.entries(contract.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => ({method: method.toUpperCase(), path})));
    expect(projection.operations.map(({method, path}) => ({method, path})))
      .toEqual(operations);
    expect(projection.origin).toBe(contract.servers[0]?.url);
    expect(projection.publicIngress).toBe(false);
  });

  it("checks the fixed renderer contract rather than relying on prose", () => {
    expect(contract.components.schemas.Bootstrap.properties)
      .toHaveProperty("rendererRevision");
    expect(projection.fixedRendererContract).toEqual({
      viewport: {width: 1440, height: 810},
      output: {
        contentType: "image/webp",
        width: 800,
        height: 450,
        maximumBytes: 2097152,
      },
      readinessDeadlineSeconds: 10,
    });
  });
});
