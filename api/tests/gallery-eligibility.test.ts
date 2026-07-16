import { describe, expect, it, vi } from "vitest";
import type { GalleryCapabilityReadiness, GalleryConfiguration } from "../src/application/gallery/configuration.js";
import { evaluateGalleryEligibility, GalleryRuntimeGate, readGalleryRuntimeEligibility } from "../src/application/gallery/eligibility.js";
import { observeGalleryCapabilityReadiness } from "../src/application/gallery/runtime-readiness.js";

const ready: GalleryCapabilityReadiness = {currentGrant: true, challengeVerifier: true, administratorAuthority: true, reporting: true, notification: true, appeal: true, governance: true, isolatedContent: true};
const configuration = (overrides: Partial<GalleryConfiguration> = {}): GalleryConfiguration => ({
  enabled: true,
  webOrigin: new URL("https://app.example.com"),
  apiOrigin: new URL("https://api.example.com"),
  contentOrigin: new URL("https://content.example-cdn.net"),
  contentRegistrableSite: "example-cdn.net",
  managementCookieDomain: "example.com",
  networkPolicy: "deny_external",
  grantRevision: "gallery-grant-v1",
  appealPolicyRevision: "gallery-appeal-v1",
  readiness: ready,
  ...overrides
});

describe("Gallery eligibility", () => {
  it("accepts a separate registrable site only when every live capability is ready", () => {
    expect(evaluateGalleryEligibility(configuration())).toEqual({eligible: true, reasons: []});
  });

  it.each([
    ["same Origin", "https://app.example.com", "same_origin"],
    ["same host another port", "https://app.example.com:8443", "same_host_different_port"],
    ["sibling subdomain", "https://content.example.com", "shared_registrable_site"],
    ["shared API site", "https://content.api.example.com", "shared_registrable_site"],
    ["IP topology", "http://10.0.0.20:8080", "non_dns_topology_unproven"]
  ])("rejects %s", (_label, contentOrigin, reason) => {
    const content = new URL(contentOrigin);
    const result = evaluateGalleryEligibility(configuration({contentOrigin: content, contentRegistrableSite: getDeclared(content)}));
    expect(result.reasons).toContain(reason);
  });

  it("rejects a cookie scope spanning the content host", () => {
    const result = evaluateGalleryEligibility(configuration({managementCookieDomain: ".example-cdn.net"}));
    expect(result.reasons).toContain("management_cookie_spans_content");
  });

  it("fails closed on disablement and every required capability", () => {
    expect(evaluateGalleryEligibility(configuration({enabled: false})).reasons).toContain("gallery_disabled");
    for (const capability of Object.keys(ready) as (keyof GalleryCapabilityReadiness)[]) {
      const result = evaluateGalleryEligibility(configuration(), {...ready, [capability]: false});
      expect(result.eligible, capability).toBe(false);
    }
  });

  it("recovers without redeploy when live readiness recovers", () => {
    let live = {...ready, governance: false};
    const gate = new GalleryRuntimeGate(configuration(), () => live);
    expect(gate.current().eligible).toBe(false);
    live = ready;
    expect(gate.current()).toEqual({eligible: true, reasons: []});
  });

  it("fails closed on stale stored status and recovers from a fresh observation", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            eligible: true,
            reasons: [],
            observed_at: new Date("2026-07-16T00:00:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            eligible: true,
            reasons: [],
            observed_at: new Date("2026-07-16T00:01:31.000Z"),
          },
        ],
      });
    await expect(
      readGalleryRuntimeEligibility(
        { query } as never,
        configuration(),
        new Date("2026-07-16T00:01:30.000Z"),
      ),
    ).resolves.toMatchObject({ eligible: false });
    await expect(
      readGalleryRuntimeEligibility(
        { query } as never,
        configuration(),
        new Date("2026-07-16T00:01:31.000Z"),
      ),
    ).resolves.toEqual({ eligible: true, reasons: [] });
  });

  it("combines live database authority with the isolated content readiness probe", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          current_grant: true,
          administrator_authority: true,
          appeal_policy: true,
        },
      ],
    }));
    const fetchImplementation = vi.fn(async () =>
      Response.json({ status: "ready" }),
    );
    await expect(
      observeGalleryCapabilityReadiness(
        { query } as never,
        configuration(),
        fetchImplementation as never,
      ),
    ).resolves.toEqual(ready);
    expect(fetchImplementation).toHaveBeenCalledWith(
      new URL("https://content.example-cdn.net/ready"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

const getDeclared = (url: URL): string => {
  const parts = url.hostname.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : url.hostname;
};
