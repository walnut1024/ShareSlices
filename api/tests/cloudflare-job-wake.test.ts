import { describe, expect, it } from "vitest";
import { createCloudflareJobWake, parseCloudflareJobWake } from "../src/cloudflare/job-wake.js";

describe("Cloudflare job wake contract", () => {
  it("creates a bounded non-sensitive wake signal", () => {
    const wake = createCloudflareJobWake({
      lane: "authentication-email",
      wakeId: "019f738a-c4e0-7000-8000-000000000001",
      durableJobId: "delivery-123",
      now: new Date("2026-07-22T01:00:00.000Z"),
    });
    expect(parseCloudflareJobWake(wake)).toEqual(wake);
    expect(Object.keys(wake)).toEqual(["version", "wakeId", "lane", "durableJobId", "createdAt"]);
    expect(JSON.stringify(wake)).not.toMatch(/@|authorization|payload|html|secret|otp/i);
  });

  it.each([
    { version: 1, wakeId: "not-a-uuid", lane: "authentication-email", createdAt: "2026-07-22T01:00:00.000Z" },
    { version: 1, wakeId: "019f738a-c4e0-7000-8000-000000000001", lane: "unknown", createdAt: "2026-07-22T01:00:00.000Z" },
    { version: 1, wakeId: "019f738a-c4e0-7000-8000-000000000001", lane: "authentication-email", createdAt: "yesterday" },
    { version: 1, wakeId: "019f738a-c4e0-7000-8000-000000000001", lane: "authentication-email", createdAt: "2026-07-22T01:00:00.000Z", apiKey: "secret" },
    { version: 1, wakeId: "019f738a-c4e0-7000-8000-000000000001", lane: "authentication-email", createdAt: "2026-07-22T01:00:00.000Z", payload: { email: "person@example.com" } },
  ])("rejects malformed or sensitive-shaped messages", (value) => {
    expect(() => parseCloudflareJobWake(value)).toThrow("invalid_job_wake");
  });
});
