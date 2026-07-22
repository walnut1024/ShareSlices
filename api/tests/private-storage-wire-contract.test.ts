import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildApp } from "../src/http/app.js";
import { buildGalleryContentApp } from "../src/content/app.js";

const contractText = readFileSync(new URL("../openapi/openapi.yaml", import.meta.url), "utf8");
const contract = parse(contractText) as unknown;

function propertyNames(value: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) propertyNames(item, names);
    return names;
  }
  if (!value || typeof value !== "object") return names;
  const record = value as Record<string, unknown>;
  if (record.properties && typeof record.properties === "object") {
    for (const name of Object.keys(record.properties as object)) names.add(name);
  }
  for (const nested of Object.values(record)) propertyNames(nested, names);
  return names;
}

describe("private object-storage wire boundary", () => {
  it("keeps raw keys, buckets, and signed storage locations out of the checked HTTP contract", () => {
    const forbiddenProperties = new Set([
      "bucket",
      "bucketName",
      "objectKey",
      "rawObjectKey",
      "rawUploadUrl",
      "signedStorageUrl",
      "signedUrl",
      "stagingObjectKey",
      "storageUrl",
    ]);
    const exposed = [...propertyNames(contract)].filter((name) => forbiddenProperties.has(name));

    expect(exposed).toEqual([]);
    expect(contractText).not.toMatch(/(?:s3|r2):\/\//i);
    expect(contractText).not.toMatch(/X-Amz-(?:Credential|Signature|Security-Token)/i);
  });

  it("does not mount raw, staging, bucket, or arbitrary object paths on either shared HTTP graph", async () => {
    const trusted = buildApp();
    const content = buildGalleryContentApp();
    const paths = [
      "/raw/upload-1.zip",
      "/staging/attempt-1/index.html",
      "/content-bundles/bundle-1/manifest.json",
      "/buckets/artifacts/objects/arbitrary",
    ];

    for (const path of paths) {
      const trustedResponse = await trusted.request(path);
      const contentResponse = await content.request(path);
      expect(trustedResponse.status, `trusted ${path}`).toBe(404);
      expect(contentResponse.status, `content ${path}`).toBe(404);
      expect(trustedResponse.headers.get("location"), `trusted ${path}`).toBeNull();
      expect(contentResponse.headers.get("location"), `content ${path}`).toBeNull();
      expect(await trustedResponse.text()).not.toContain(path);
      expect(await contentResponse.text()).not.toContain(path);
    }
  });
});
