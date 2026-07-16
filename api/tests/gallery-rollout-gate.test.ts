import { beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryUnavailableError } from "../src/application/gallery/eligibility.js";
import { galleryRoutes } from "../src/http/gallery-routes.js";

const session = {getSession: vi.fn(async () => ({user: {id: "user-1"}}))};
const disabledGate = {requireEligible: vi.fn(() => { throw new GalleryUnavailableError(["gallery_disabled"]); }), current: vi.fn()};

describe("Gallery live rollout gate", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(["/gallery", "/gallery/newest", "/gallery/featured", "/gallery/search", "/gallery/tags/demo", "/gallery/opaque", "/gallery/opaque/download", "/gallery/opaque/player-authorizations", "/gallery/creators/creator"])("returns pre-lookup 503 for %s", async (path) => {
    const publicGallery = {list: vi.fn(), listing: vi.fn(), creator: vi.fn()};
    const app = galleryRoutes({gate: disabledGate as never, publicGallery: publicGallery as never});
    const response = await app.request(path, {method: path.endsWith("player-authorizations") ? "POST" : "GET"});
    expect(response.status).toBe(503);
    expect(publicGallery.list).not.toHaveBeenCalled();
    expect(publicGallery.listing).not.toHaveBeenCalled();
    expect(publicGallery.creator).not.toHaveBeenCalled();
  });

  it("keeps authenticated owner view and permanent withdrawal available", async () => {
    const owner = {view: vi.fn(async () => null), withdraw: vi.fn(async () => ({listingId: "listing-1", lifecycle: "withdrawn"}))};
    const app = galleryRoutes({gate: disabledGate as never, authApi: session as never, owner: owner as never});
    expect((await app.request("/api/artifacts/artifact-1/gallery-listing")).status).toBe(200);
    const withdrawn = await app.request("/api/gallery-listings/listing-1", {method: "DELETE", headers: {"If-Match": '"1"', "Idempotency-Key": "operation-1"}});
    expect(withdrawn.status).toBe(200);
    expect(disabledGate.requireEligible).not.toHaveBeenCalled();
  });

  it("does not use public disablement to hide notifications or administration", async () => {
    const governance = {notifications: vi.fn(async () => []), queue: vi.fn(async () => [])};
    const app = galleryRoutes({gate: disabledGate as never, authApi: session as never, governance: governance as never});
    expect((await app.request("/api/gallery/notifications")).status).toBe(200);
    expect((await app.request("/api/admin/gallery/cases?queue=reports")).status).toBe(200);
    expect(disabledGate.requireEligible).not.toHaveBeenCalled();
  });
});
