// cspell:ignore WDJF XZPL
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approveCliAuthorization, denyCliAuthorization, getCliAuthorization } from "./cli-auth";

describe("CLI authorization Web client", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reads a pending authorization with browser credentials", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ authorization: { userCode: "WDJF-XZPL", status: "pending" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetch);

    await expect(getCliAuthorization("WDJF-XZPL")).resolves.toEqual({
      userCode: "WDJF-XZPL",
      status: "pending"
    });
    expect(fetch).toHaveBeenCalledWith("/api/cli-authorizations/WDJF-XZPL", { credentials: "include" });
  });

  it("approves and denies through explicit browser actions", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await approveCliAuthorization("WDJF-XZPL");
    await denyCliAuthorization("WDJF-XZPL");

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/cli-authorizations/WDJF-XZPL:approve", {
      method: "POST",
      credentials: "include"
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/cli-authorizations/WDJF-XZPL:deny", {
      method: "POST",
      credentials: "include"
    });
  });
});
