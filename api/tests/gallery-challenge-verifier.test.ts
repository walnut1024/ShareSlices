import { describe, expect, it, vi } from "vitest";
import {
  DeterministicChallengeVerifier,
  TurnstileChallengeVerifier,
} from "../src/application/gallery/challenge-verifier.js";
describe("Gallery challenge verifier", () => {
  it("accepts only the deterministic test token", async () => {
    const verifier = new DeterministicChallengeVerifier();
    expect(
      (
        await verifier.verify({
          token: "valid-test-challenge",
        })
      ).success,
    ).toBe(true);
    expect(
      (
        await verifier.verify({
          token: "no",
        })
      ).success,
    ).toBe(false);
  });
  it("uses canonical server-side siteverify and binds the expected action", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ success: true, action: "gallery-report" }),
    );
    const verifier = new TurnstileChallengeVerifier(
      "secret-for-tests",
      fetcher,
    );
    expect(
      (
        await verifier.verify({
          token: "token",
          remoteIp: "203.0.113.1",
          expectedAction: "gallery-report",
        })
      ).success,
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" }),
    );
  });
  it("fails closed on action mismatch and verifier outage", async () => {
    const mismatch = new TurnstileChallengeVerifier("secret", async () =>
      Response.json({ success: true, action: "other" }),
    );
    expect(
      (
        await mismatch.verify({
          token: "x",
          remoteIp: "x",
          expectedAction: "gallery-report",
        })
      ).reasonCode,
    ).toBe("rejected");
    const outage = new TurnstileChallengeVerifier("secret", async () => {
      throw new Error("offline");
    });
    expect(
      (
        await outage.verify({
          token: "x",
          remoteIp: "x",
          expectedAction: "gallery-report",
        })
      ).reasonCode,
    ).toBe("unavailable");
  });
});
