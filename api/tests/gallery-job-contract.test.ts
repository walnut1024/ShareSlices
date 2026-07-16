import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGalleryJobEnvelope, supportedGalleryJobContractVersions } from "../src/application/gallery/job-contract.js";

const fixture = (name: string): unknown => JSON.parse(readFileSync(resolve("../db/contracts/gallery-jobs/fixtures", name), "utf8"));

describe("Gallery cross-runtime job contract", () => {
  it.each(["gallery-job-v1.json", "gallery-job-v0.json"])("accepts current and N-1 fixture %s", (name) => {
    expect(parseGalleryJobEnvelope(fixture(name)).jobId).toBeTruthy();
  });

  it("rejects a future contract version", () => {
    expect(() => parseGalleryJobEnvelope({...fixture("gallery-job-v1.json") as object, contractVersion: "gallery-job/v2"})).toThrow();
    expect(supportedGalleryJobContractVersions).toEqual(["gallery-job/v1", "gallery-job/v0"]);
  });

  it("enforces API-owned copy admission input as one complete immutable snapshot", () => {
    const value = structuredClone(fixture("gallery-job-v1.json")) as {input: Record<string, unknown>};
    delete value.input.sourceRetentionReferenceId;
    expect(() => parseGalleryJobEnvelope(value)).toThrow("complete API-owned");
  });
});
