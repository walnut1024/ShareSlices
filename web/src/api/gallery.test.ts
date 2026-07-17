import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOwnerGalleryListing,
  listGalleryGovernanceCases,
  shareArtifactToGallery,
} from "./gallery";

afterEach(() => vi.restoreAllMocks());

describe("Gallery owner API", () => {
  it("retains checked access and public URL fields from owner projections", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      listing: ownerProjection,
    }));

    await expect(getOwnerGalleryListing("artifact-1")).resolves.toMatchObject({
      id: "listing-1",
      artifactId: "artifact-1",
      lifecycle: "listed",
      reviewState: "clear",
      effectiveAccess: {accessible: true, restrictions: []},
      publicUrl: "/gallery/public-1",
    });
  });

  it("parses the current projection returned by an accepted share", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      historicalOutcome: {status: "accepted"},
      current: ownerProjection,
    }, {status: 202}));

    const result = await shareArtifactToGallery("artifact-1", {
      versionId: "version-1",
      profile: {displayName: "Ada", biography: null, avatar: null, expectedRevision: null},
      permission: {grantVersion: "gallery-grant-v1", accepted: true},
      metadata: {title: "Report", description: null, tags: []},
    }, "operation-1");

    expect(result.current).toMatchObject({
      artifactId: "artifact-1",
      listingRevision: 3,
      publicUrl: "/gallery/public-1",
    });
  });
});

const ownerProjection = {
  id: "listing-1",
  artifactId: "artifact-1",
  lifecycle: "listed",
  reviewState: "clear",
  closureReason: null,
  revision: 3,
  proposal: null,
  effectiveAccess: {accessible: true, restrictions: []},
  publicUrl: "/gallery/public-1",
  allowedActions: ["update_gallery"],
};

describe("Gallery administration API", () => {
  it("follows queue pagination and bounds case-detail concurrency", async () => {
    let activeDetails = 0;
    let peakDetails = 0;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "https://shareslices.test");
      if (url.pathname === "/api/admin/gallery/cases") {
        const queue = url.searchParams.get("queue");
        const cursor = url.searchParams.get("cursor");
        if (queue !== "proposals") {
          return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
        }
        const offset = cursor ? 24 : 0;
        const count = cursor ? 6 : 24;
        return new Response(JSON.stringify({
          items: Array.from({ length: count }, (_, index) => ({
            id: `case-${offset + index}`,
            queue,
            state: "open",
            createdAt: "2026-07-16T00:00:00.000Z",
            listingRevision: 1,
          })),
          nextCursor: cursor ? null : "next-page",
        }), { status: 200 });
      }
      if (url.pathname.startsWith("/api/admin/gallery/cases/")) {
        activeDetails += 1;
        peakDetails = Math.max(peakDetails, activeDetails);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeDetails -= 1;
        return new Response(JSON.stringify({
          plainTextEvidence: "evidence",
          allowedDecisions: ["dismiss"],
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const cases = await listGalleryGovernanceCases();

    expect(cases).toHaveLength(30);
    expect(peakDetails).toBeLessThanOrEqual(4);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("queue=proposals&limit=24&cursor=next-page"),
      expect.anything(),
    );
  });

  it("loads queues sequentially instead of issuing a six-request burst", async () => {
    const requestedQueues: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "https://shareslices.test");
      if (url.pathname === "/api/admin/gallery/cases") {
        requestedQueues.push(url.searchParams.get("queue") ?? "");
        return new Response(JSON.stringify({
          items: [],
          nextCursor: null,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ plainTextEvidence: null, allowedDecisions: [] }), { status: 200 });
    });

    const cases = await listGalleryGovernanceCases();

    expect(cases).toEqual([]);
    expect(requestedQueues).toEqual([
      "proposals",
      "reports",
      "appeals",
      "restrictions",
      "takedowns",
      "removals",
    ]);
  });
});
