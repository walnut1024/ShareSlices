import { describe, expect, it, vi } from "vitest";
import { GalleryOwnerOperationError } from "../src/application/gallery/owner-operations.js";
import { galleryRoutes } from "../src/http/gallery-routes.js";

const readyGate = {
  requireEligible: vi.fn(),
  current: vi.fn(() => ({ eligible: true, reasons: [] })),
};
const session = (userId: string | null) => ({
  getSession: vi.fn(async () =>
    userId ? { user: { id: userId }, session: {} } : null,
  ),
});

describe("Gallery HTTP contract boundaries", () => {
  it.each([
    "/gallery?limit=abc",
    "/gallery?limit=0",
    "/gallery?limit=101",
    "/gallery?cursor=not-a-cursor",
    "/gallery/search",
    "/gallery/search?q=",
    `/gallery/search?q=${"x".repeat(201)}`,
  ])("rejects invalid public collection input at the HTTP boundary: %s", async (path) => {
    const list = vi.fn();
    const response = await galleryRoutes({
      gate: readyGate as never,
      publicGallery: { list } as never,
    }).request(path);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_request" },
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("uses the documented default page size", async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null }));
    const response = await galleryRoutes({
      gate: readyGate as never,
      publicGallery: { list } as never,
    }).request("/gallery");

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 24 }),
    );
  });

  it("does not disguise unexpected public Gallery failures as rollout unavailability", async () => {
    const response = await galleryRoutes({
      gate: readyGate as never,
      publicGallery: {
        list: vi.fn(async () => {
          throw new Error("database failed");
        }),
      } as never,
    }).request("/gallery");

    expect(response.status).toBe(500);
  });

  it("returns only an absolute isolated-content player URL", async () => {
    const credentials = {
      issuePublic: vi.fn(async () => ({
        credential: "secret-not-for-the-web-app",
        expiresAt: new Date("2026-07-16T00:05:00.000Z"),
        entryUrlPath: "/gallery-content/public/secret-not-for-the-web-app/",
      })),
    };
    const response = await galleryRoutes({
      gate: readyGate as never,
      credentials: credentials as never,
    }).request("/gallery/opaque-slug/player-authorizations", {
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      entryUrl:
        "https://content.example-cdn.test/gallery-content/public/secret-not-for-the-web-app/",
      expiresAt: "2026-07-16T00:05:00.000Z",
    });
  });

  it("accepts an authenticated report without an anonymous challenge", async () => {
    const reports = { submit: vi.fn(async (_input: unknown) => undefined) };
    const response = await galleryRoutes({
      authApi: session("reporter-1") as never,
      gate: readyGate as never,
      reports: reports as never,
    }).request("/gallery/opaque-slug/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: "malware", details: "Plain evidence" }),
    });

    expect(response.status).toBe(202);
    expect(reports.submit).toHaveBeenCalledWith(
      expect.objectContaining({ reporterUserId: "reporter-1" }),
    );
    expect(reports.submit.mock.calls[0]?.[0]).not.toHaveProperty(
      "challengeToken",
    );
  });

  it("rejects a client-supplied avatar object key before owner mutation", async () => {
    const owner = { share: vi.fn() };
    const response = await galleryRoutes({
      authApi: session("owner-1") as never,
      owner: owner as never,
      gate: readyGate as never,
    }).request("/api/artifacts/artifact-1/gallery-listing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "share-1",
      },
      body: JSON.stringify({
        versionId: "version-1",
        profile: {
          displayName: "Ada",
          biography: null,
          avatar: {
            objectKey: "another-user/private-avatar",
            contentType: "image/png",
            width: 1,
            height: 1,
          },
          expectedRevision: null,
        },
        permission: { grantVersion: "grant-v1", accepted: true },
        metadata: { title: "Demo", description: null, tags: ["demo"] },
      }),
    });

    expect(response.status).toBe(400);
    expect(owner.share).not.toHaveBeenCalled();
  });

  it("returns historical owner outcome separately from current projection", async () => {
    const current = {
      id: "glisting_current",
      artifactId: "artifact-1",
      lifecycle: "pending",
      reviewState: "clear",
      closureReason: null,
      revision: 1,
    };
    const owner = {
      share: vi.fn(async () => ({
        operationId: "goperation_accepted",
        operation: "share_to_gallery",
        acceptedAt: "2026-07-16T00:00:00.000Z",
        status: "accepted",
        artifactId: "artifact-1",
        listingId: "glisting_current",
        listingRevision: 1,
        proposalId: "gproposal_1",
        lifecycle: "pending",
        recovered: false,
      })),
      view: vi.fn(async () => current),
    };
    const response = await galleryRoutes({
      authApi: session("owner-1") as never,
      owner: owner as never,
      gate: readyGate as never,
    }).request("/api/artifacts/artifact-1/gallery-listing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "share-1",
      },
      body: JSON.stringify({
        versionId: "version-1",
        profile: {
          displayName: "Ada",
          biography: null,
          avatar: null,
          expectedRevision: null,
        },
        permission: { grantVersion: "grant-v1", accepted: true },
        metadata: { title: "Demo", description: null, tags: ["demo"] },
      }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      historicalOutcome: {
        operationId: "goperation_accepted",
        operation: "share_to_gallery",
        acceptedAt: "2026-07-16T00:00:00.000Z",
        status: "accepted",
        committedListingRevision: 1,
      },
      current,
    });
  });

  it.each([
    ["PATCH", "/api/gallery-listings/missing"],
    ["DELETE", "/api/gallery-listings/missing"],
  ])("maps an absent owner listing to 404 for %s", async (method, path) => {
    const owner = {
      updateListing: vi.fn(async () => {
        throw new GalleryOwnerOperationError("listing_not_found");
      }),
      withdraw: vi.fn(async () => {
        throw new GalleryOwnerOperationError("listing_not_found");
      }),
    };
    const init = method === "PATCH"
      ? {
          method,
          headers: {
            "content-type": "application/json",
            "idempotency-key": "operation-1",
            "if-match": '"1"',
          },
          body: JSON.stringify({
            versionId: "version-1",
            profile: {
              displayName: "Ada",
              biography: null,
              avatar: null,
              expectedRevision: 1,
            },
            permission: { grantVersion: "grant-v1", accepted: true },
            metadata: { title: "Demo", description: null, tags: [] },
          }),
        }
      : {
          method,
          headers: {
            "idempotency-key": "operation-1",
            "if-match": '"1"',
          },
        };
    const response = await galleryRoutes({
      authApi: session("owner-1") as never,
      owner: owner as never,
      gate: readyGate as never,
    }).request(path, init);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "listing_not_found" },
    });
  });
});
