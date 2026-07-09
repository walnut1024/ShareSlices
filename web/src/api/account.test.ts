import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession, createUser } from "./account";

describe("account API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts registration to /api/users", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ user: { id: "user_1", name: "Ada", email: "ada@example.com" } }), {
          status: 201,
          headers: { "content-type": "application/json" }
        })
      )
    );

    await expect(createUser({ name: "Ada", email: "ada@example.com", password: "password123" })).resolves.toEqual({
      id: "user_1",
      name: "Ada",
      email: "ada@example.com"
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/users",
      expect.objectContaining({
        method: "POST",
        credentials: "include"
      })
    );
  });

  it("normalizes login failures to one client error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { code: "invalid_login", message: "Email or password is incorrect.", requestId: "req_1" }
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" }
          }
        )
      )
    );

    await expect(createSession({ email: "unknown@example.com", password: "wrong password" })).rejects.toThrow(
      "Email or password is incorrect."
    );
  });
});
