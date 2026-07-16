import { describe, expect, it, vi } from "vitest";
import { PublicGalleryService } from "../src/application/gallery/public-gallery.js";
import { galleryRoutes } from "../src/http/gallery-routes.js";

const row = (id: string, createdAt: string) => ({id, opaque_slug: `opaque-${id}`, created_at: new Date(createdAt), public_title: `<b>${id}</b>`, public_description: "plain & safe", tags: ["demo"], creator_slug: "creator-opaque", display_name: "Ada <script>", cover_state: "failed", object_key: null, primary_key: createdAt});

describe("public Gallery discovery and Creator profiles", () => {
  it("uses an opaque deterministic keyset cursor and immutable listing creation time", async () => {
    const query = vi.fn(async (_sql: string, values: unknown[]) => ({rows: values.length === 1 ? [row("3", "2026-07-03T00:00:00Z"), row("2", "2026-07-02T00:00:00Z"), row("1", "2026-07-01T00:00:00Z")] : []}));
    const service = new PublicGalleryService({query} as never);
    const first = await service.list({mode: "default", limit: 2});
    expect(first.items.map((item) => item.createdAt)).toEqual(["2026-07-03T00:00:00.000Z", "2026-07-02T00:00:00.000Z"]);
    expect(first.items[0]?.title).toBe("<b>3</b>");
    expect(first.items[0]?.cover).toEqual({state: "placeholder", url: null});
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    await service.list({mode: "default", cursor: first.nextCursor!, limit: 2});
    expect(query.mock.calls[1]?.[1]).toEqual([3, "2026-07-02T00:00:00Z", "2"]);
  });

  it("binds search and normalized tag values instead of interpolating metadata", async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({rows: []}));
    const service = new PublicGalleryService({query} as never);
    await service.list({mode: "search", query: "<script>", limit: 10});
    await service.list({mode: "tag", query: "DeMo", limit: 10});
    expect(query.mock.calls[0]?.[1]).toEqual([11, "%<script>%"]);
    expect(query.mock.calls[1]?.[1]).toEqual([11, "demo"]);
    expect(query.mock.calls[0]?.[0]).toContain(
      "listing.review_state in ('clear','reviewing')",
    );
    expect(query.mock.calls[0]?.[0]).toContain("unnest(revision.tags)");
  });

  it("projects safe original Creator attribution without private lineage identifiers", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          ...row("copy", "2026-07-03T00:00:00Z"),
          artifact_id: "artifact-copy",
          lifecycle_state: "listed",
          review_state: "clear",
          profile_retired_at: null,
          provenance_artifact_id: "artifact-copy",
          original_creator_slug: "original-creator",
          original_creator_display_name: "Original Ada",
          original_creator_public_at: new Date("2026-07-01T00:00:00Z"),
          original_creator_retired_at: null,
        }],
      })
      .mockResolvedValueOnce({rows: [{blocked: false}]});
    const service = new PublicGalleryService({query} as never);

    const result = await service.listing("opaque-copy");

    expect(result).toMatchObject({
      kind: "eligible",
      listing: {
        sourceAttribution: {
          originalCreator: {
            slug: "original-creator",
            displayName: "Original Ada",
          },
        },
      },
    });
    if (result.kind === "eligible") {
      expect(result.listing).not.toHaveProperty("versionId");
      expect(result.listing).not.toHaveProperty("provenance");
      expect(result.listing.sourceAttribution).not.toHaveProperty("rootListingId");
      expect(result.listing.sourceAttribution).not.toHaveProperty("rootVersionId");
    }
  });

  it("uses unavailable attribution after the original Creator is retired", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          ...row("copy", "2026-07-03T00:00:00Z"),
          artifact_id: "artifact-copy",
          lifecycle_state: "listed",
          review_state: "clear",
          profile_retired_at: null,
          provenance_artifact_id: "artifact-copy",
          original_creator_slug: "retired-creator",
          original_creator_display_name: "Private old name",
          original_creator_public_at: new Date("2026-07-01T00:00:00Z"),
          original_creator_retired_at: new Date("2026-07-02T00:00:00Z"),
        }],
      })
      .mockResolvedValueOnce({rows: [{blocked: false}]});
    const service = new PublicGalleryService({query} as never);

    const result = await service.listing("opaque-copy");

    expect(result).toMatchObject({
      kind: "eligible",
      listing: {sourceAttribution: {originalCreator: null}},
    });
  });

  it("returns public empty profiles as 200, unknown profiles as 404, and never 410", async () => {
    const gate = {requireEligible: vi.fn()};
    const publicGallery = {creator: vi.fn(async (slug: string) => slug === "public" ? {profile: {slug, displayName: "Ada", biography: null, avatarUrl: null}, listings: {items: [], nextCursor: null}} : null)};
    const app = galleryRoutes({gate: gate as never, publicGallery: publicGallery as never});
    const publicResponse = await app.request("/gallery/creators/public");
    const missingResponse = await app.request("/gallery/creators/staged-or-deleted");
    expect(publicResponse.status).toBe(200);
    expect((await publicResponse.json()).listings.items).toEqual([]);
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.status).not.toBe(410);
  });
});
