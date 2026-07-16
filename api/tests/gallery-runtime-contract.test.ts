import { describe, expect, it, vi } from "vitest";
import { buildGalleryContentApp } from "../src/content/app.js";
import { GalleryUnavailableError } from "../src/application/gallery/eligibility.js";
import { buildApp } from "../src/http/app.js";

const signedOut = {
  getSession: vi.fn(async () => null),
};

const disabledGate = {
  requireEligible: vi.fn(() => {
    throw new GalleryUnavailableError(["gallery_disabled"]);
  }),
  current: vi.fn(),
};

const request = (method: string, path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    ...(body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });

describe("Gallery checked contract against the running Hono stacks", () => {
  it.each([
    ["GET", "/api/gallery/permission-grant"],
    ["GET", "/api/gallery/profile"],
    ["PATCH", "/api/gallery/profile"],
    ["POST", "/api/gallery/profile/avatar-uploads"],
    ["GET", "/api/artifacts/artifact-1/gallery-listing"],
    ["POST", "/api/artifacts/artifact-1/gallery-listing"],
    ["PATCH", "/api/gallery-listings/listing-1"],
    ["DELETE", "/api/gallery-listings/listing-1"],
    ["POST", "/api/gallery/slug-1/copy-operations"],
    ["GET", "/api/gallery-copy-operations/operation-1"],
    ["POST", "/api/gallery-decisions/decision-1/appeals"],
    ["GET", "/api/gallery/notifications"],
    ["GET", "/api/admin/gallery/cases"],
    ["GET", "/api/admin/gallery/cases/case-1"],
    ["POST", "/api/admin/gallery/cases/case-1/review-authorizations"],
    ["POST", "/api/admin/gallery/cases/case-1/decisions"],
    ["PUT", "/api/admin/gallery/featured-positions/1"],
    ["DELETE", "/api/admin/gallery/featured-positions/1"],
  ])("mounts authenticated %s %s with the stable unauthenticated envelope", async (method, path) => {
    const app = buildApp({
      gallery: { authApi: signedOut as never, gate: disabledGate as never },
    });
    const response = await app.request(request(method, path));
    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: { code: "unauthenticated", requestId: expect.any(String) },
    });
  });

  it.each([
    ["GET", "/gallery"],
    ["GET", "/gallery/newest"],
    ["GET", "/gallery/featured"],
    ["GET", "/gallery/search?q=demo"],
    ["GET", "/gallery/tags/demo"],
    ["GET", "/gallery/creators/creator-1"],
    ["GET", "/gallery/slug-1"],
    ["POST", "/gallery/slug-1/player-authorizations"],
    ["GET", "/gallery/slug-1/download"],
    ["GET", "/gallery-media/avatar/creator-1"],
  ])("mounts public %s %s behind pre-lookup eligibility", async (method, path) => {
    const app = buildApp({ gallery: { gate: disabledGate as never } });
    const response = await app.request(request(method, path));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "gallery_unavailable", requestId: expect.any(String) },
    });
  });

  it("mounts anonymous report intake behind validation, challenge, and eligibility", async () => {
    const app = buildApp({
      gallery: { authApi: signedOut as never, gate: disabledGate as never },
    });
    const response = await app.request(
      request("POST", "/gallery/slug-1/reports", {
        category: "malware",
        details: "A bounded plain-text report.",
        challengeToken: "challenge-token",
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "gallery_unavailable", requestId: expect.any(String) },
    });
  });

  it.each([
    "/gallery-content/public/player-credential/",
    "/gallery-content/public/player-credential/assets/app.js",
    "/gallery-content/review/review-credential/",
    "/gallery-content/review/review-credential/assets/app.js",
  ])("mounts isolated content %s and fails closed before credential lookup", async (path) => {
    const response = await buildGalleryContentApp().request(path);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: "gallery_content_unavailable",
        requestId: expect.any(String),
      },
    });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
