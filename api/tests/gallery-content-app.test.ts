import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGalleryContentApp } from "../src/content/app.js";

describe("content-only Gallery application", () => {
  it("has only health, readiness, public-player, and review route groups", async () => {
    const app = buildGalleryContentApp();
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/ready")).status).toBe(503);
    for (const path of ["/api/artifacts", "/api/sessions/current", "/api/admin/gallery/cases"]) {
      expect((await app.request(path)).status).toBe(404);
    }
  });

  it("fails both credential paths closed until both validators and content adapters exist", async () => {
    const app = buildGalleryContentApp();
    for (const path of ["/gallery-content/public/secret/index.html", "/gallery-content/review/secret/index.html"]) {
      const response = await app.request(path);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  it("does not enable one credential path without the other", async () => {
    const validator = {validate: async () => ({})};
    const lookup = {resolve: async () => ({})};
    const storage = {stream: async () => new Response()};
    const publicOnly = buildGalleryContentApp({publicPlayer: validator, lookup, storage});
    const reviewOnly = buildGalleryContentApp({administratorReview: validator, lookup, storage});
    expect((await publicOnly.request("/ready")).status).toBe(503);
    expect((await reviewOnly.request("/ready")).status).toBe(503);
  });

  it("keeps public and review credentials route-disjoint and resolves only normalized manifest paths", async () => {
    const publicBinding = {kind: "public", versionId: "version-public"};
    const reviewBinding = {kind: "review", versionId: "version-review"};
    const app = buildGalleryContentApp({
      publicPlayer: {validate: async (credential) => credential === "public-token" ? publicBinding : null},
      administratorReview: {validate: async (credential) => credential === "review-token" ? reviewBinding : null},
      lookup: {resolve: async (binding, path) => ({binding, path})},
      storage: {stream: async (asset) => Response.json(asset)}
    });
    expect((await app.request("/ready")).status).toBe(200);
    expect(await (await app.request("/gallery-content/public/public-token/index.html")).json()).toEqual({binding: publicBinding, path: "index.html"});
    expect(await (await app.request("/gallery-content/review/review-token/index.html")).json()).toEqual({binding: reviewBinding, path: "index.html"});
    expect((await app.request("/gallery-content/public/review-token/index.html")).status).toBe(404);
    expect((await app.request("/gallery-content/review/public-token/index.html")).status).toBe(404);
    expect((await app.request("/gallery-content/public/public-token/%2e%2e/secret")).status).toBe(404);
  });

  it("enforces sandbox, network, storage, CORS, cookie, and indexing policy on every content response", async () => {
    const response = await buildGalleryContentApp().request("/gallery-content/public/secret/index.html");
    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("sandbox allow-scripts");
    expect(response.headers.get("permissions-policy")).toContain("fullscreen=()");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
  });

  it("serves only credential-bound relative classic, module, and data fixture paths", async () => {
    const root = new URL("./fixtures/gallery-content/", import.meta.url);
    const manifest = new Set(["index.html", "classic.js", "module.js", "data.json"]);
    const app = buildGalleryContentApp({
      publicPlayer: { validate: async (credential) => credential === "public-token" ? {kind: "public"} : null },
      administratorReview: { validate: async (credential) => credential === "review-token" ? {kind: "review"} : null },
      lookup: { resolve: async (_binding, path) => manifest.has(path) ? path : null },
      storage: { stream: async (asset) => new Response(readFileSync(new URL(String(asset), root))) },
    });
    for (const asset of manifest) {
      const response = await app.request(`/gallery-content/public/public-token/${asset}`);
      expect(response.status, asset).toBe(200);
      expect(response.headers.get("cache-control"), asset).toBe("no-store");
      expect(response.headers.has("set-cookie"), asset).toBe(false);
    }
    expect((await app.request("/gallery-content/public/public-token/remote.js")).status).toBe(404);
    expect((await app.request("/gallery-content/public/review-token/data.json")).status).toBe(404);
  });

  it("revalidates role and case state for every delayed review asset", async () => {
    let activeRole = true;
    let openCase = true;
    const app = buildGalleryContentApp({
      publicPlayer: { validate: async () => null },
      administratorReview: {
        validate: async (credential) =>
          credential === "review-token" && activeRole && openCase
            ? {kind: "review", caseId: "case-1"}
            : null,
      },
      lookup: { resolve: async (_binding, path) => ({path}) },
      storage: { stream: async () => new Response("asset") },
    });
    expect((await app.request("/gallery-content/review/review-token/index.html")).status).toBe(200);
    activeRole = false;
    expect((await app.request("/gallery-content/review/review-token/module.js")).status).toBe(404);
    activeRole = true;
    openCase = false;
    expect((await app.request("/gallery-content/review/review-token/data.json")).status).toBe(404);
  });
});
