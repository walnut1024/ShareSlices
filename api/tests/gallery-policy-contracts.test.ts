import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../db/contracts/gallery-policy/${name}`, import.meta.url), "utf8"),
  ) as Record<string, unknown>;

describe("approved Gallery policy contracts", () => {
  it("checks in one indivisible exact permission grant", () => {
    const grant = read("gallery-permission-grant-v1.json");
    expect(grant.permissions).toEqual(["view", "gallery_download", "save_a_copy"]);
    expect(grant.exactText).toMatch(/independently owned copy/);
    expect(createHash("sha256").update(String(grant.exactText)).digest("hex")).toHaveLength(64);
  });

  it("pins the Appeal deadline and bounded plain-text notice contract", () => {
    const appeal = read("gallery-appeal-policy-v1.json");
    const retention = read("gallery-notice-and-retention-v1.json");
    expect(appeal.deadlineSeconds).toBe(14 * 24 * 60 * 60);
    expect(retention.rendering).toBe("bounded_escaped_plain_text");
    expect(retention.viewerSignalMaximumDays).toBe(30);
  });
});
