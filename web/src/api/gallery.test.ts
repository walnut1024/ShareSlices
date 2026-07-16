import { afterEach, describe, expect, it, vi } from "vitest";
import { listGalleryGovernanceCases } from "./gallery";

afterEach(() => vi.restoreAllMocks());

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
