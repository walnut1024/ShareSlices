import { describe, expect, it, vi } from "vitest";
import { galleryRoutes } from "../src/http/gallery-routes.js";

function appFor(userId: string | null, governance: Record<string, unknown>) {
  return galleryRoutes({
    authApi: {
      getSession: vi
        .fn()
        .mockResolvedValue(
          userId ? { user: { id: userId }, session: {} } : null,
        ),
    } as never,
    governance: governance as never,
  });
}

describe("Gallery governance route boundaries", () => {
  it("returns 403 when review authorization lacks Administrator authority", async () => {
    const credentials = {
      issueReview: vi.fn().mockRejectedValue({
        code: "administrator_forbidden",
      }),
    };
    const response = await galleryRoutes({
      authApi: {
        getSession: vi.fn().mockResolvedValue({
          user: { id: "user-1" },
          session: {},
        }),
      } as never,
      credentials: credentials as never,
    }).request("/api/admin/gallery/cases/case-1/review-authorizations", {
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "administrator_forbidden" },
    });
  });

  it("does not call the governance queue for signed-out users", async () => {
    const queue = vi.fn();
    const response = await appFor(null, { queue }).request(
      "/api/admin/gallery/cases?queue=reports",
    );
    expect(response.status).toBe(401);
    expect(queue).not.toHaveBeenCalled();
  });

  it("hides the queue when scoped Administrator authority is absent", async () => {
    const queue = vi
      .fn()
      .mockRejectedValue({ code: "administrator_forbidden" });
    const response = await appFor("user-1", { queue }).request(
      "/api/admin/gallery/cases?queue=reports",
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "administrator_forbidden" },
    });
  });

  it("returns only the static queue projection from the authorized adapter", async () => {
    const queue = vi.fn().mockResolvedValue({
      items: [{id: "case-1", queue: "reports", state: "open", createdAt: "2026-07-16T00:00:00.000Z", listingRevision: 2}],
      nextCursor: null,
    });
    const response = await appFor("admin-1", { queue }).request(
      "/api/admin/gallery/cases?queue=reports",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [{id: "case-1", queue: "reports", state: "open", createdAt: "2026-07-16T00:00:00.000Z", listingRevision: 2}],
      nextCursor: null,
    });
    expect(queue).toHaveBeenCalledWith("admin-1", "reports", undefined, 50);
  });
});
