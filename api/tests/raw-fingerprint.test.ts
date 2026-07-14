import { describe, expect, it } from "vitest";
import { RawFingerprintCandidates } from "../src/application/artifacts/raw-fingerprint.js";

describe("Raw Upload fingerprint candidates", () => {
  const rawSha256 = "a".repeat(64);

  it("creates current and previous private candidates", () => {
    const fingerprints = new RawFingerprintCandidates({
      current: { revision: "key-v2", secret: "current-fingerprint-secret-at-least-thirty-two-bytes" },
      previous: { revision: "key-v1", secret: "previous-fingerprint-secret-at-least-thirty-two-bytes" }
    });

    const candidates = fingerprints.create("owner-1", rawSha256);

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.keyRevision)).toEqual(["key-v2", "key-v1"]);
    expect(candidates[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(candidates[0]?.fingerprint).not.toBe(candidates[1]?.fingerprint);
  });

  it("separates fingerprints by owning User and purpose", () => {
    const key = { revision: "key-v1", secret: "fingerprint-secret-with-at-least-thirty-two-bytes" };
    const raw = new RawFingerprintCandidates({ current: key });
    const otherPurpose = new RawFingerprintCandidates({ current: key, purpose: "other-purpose" });

    expect(raw.create("owner-1", rawSha256)[0]?.fingerprint).not.toBe(
      raw.create("owner-2", rawSha256)[0]?.fingerprint
    );
    expect(raw.create("owner-1", rawSha256)[0]?.fingerprint).not.toBe(
      otherPurpose.create("owner-1", rawSha256)[0]?.fingerprint
    );
  });
});
