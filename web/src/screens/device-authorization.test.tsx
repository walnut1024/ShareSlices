// cspell:ignore WDJF XZPL
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const account = { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" };

describe("CLI device authorization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/device?user_code=WDJF-XZPL");
  });

  it("keeps the verification code visible while a signed-out user logs in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "unauthenticated", message: "Sign in to continue.", requestId: "req-1" } }), { status: 401 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ signedIn: true, user: account }), { status: 201, headers: { "content-type": "application/json" } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ authorization: { userCode: "WDJF-XZPL", status: "pending" } }), { status: 200, headers: { "content-type": "application/json" } }))
    );

    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("WDJF-XZPL")).toBeVisible();
    expect(screen.getByText("Confirm this matches the code in your terminal before signing in.")).toBeVisible();
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Authorize the ShareSlices CLI?" })).toBeVisible();
    expect(window.location.pathname + window.location.search).toBe("/device?user_code=WDJF-XZPL");
  });

  it("shows the account without switching and completes approval in place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ user: account }), { status: 200, headers: { "content-type": "application/json" } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ authorization: { userCode: "WDJF-XZPL", status: "pending" } }), { status: 200, headers: { "content-type": "application/json" } }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
    );
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("ada@example.com")).toBeVisible();
    expect(screen.queryByText("Switch")).not.toBeInTheDocument();
    expect(screen.queryByText(/device|scope|session id|keychain/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("heading", { name: "CLI authorized" })).toBeVisible();
    expect(screen.getByText("You can close this window.")).toBeVisible();
    expect(window.location.pathname + window.location.search).toBe("/device?user_code=WDJF-XZPL");
  });

  it("denies explicitly without creating a success state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ user: account }), { status: 200, headers: { "content-type": "application/json" } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ authorization: { userCode: "WDJF-XZPL", status: "pending" } }), { status: 200, headers: { "content-type": "application/json" } }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Deny" }));
    expect(await screen.findByRole("heading", { name: "Authorization denied" })).toBeVisible();
    expect(screen.queryByText("CLI authorized")).not.toBeInTheDocument();
  });

  it.each([
    ["invalid_grant", "Invalid verification code"],
    ["expired_token", "Verification code expired"],
    ["access_denied", "Authorization unavailable"]
  ])("shows a focused terminal state for %s", async (code, heading) => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ user: account }), { status: 200, headers: { "content-type": "application/json" } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code, message: "Rejected", requestId: "req-edge" } }), { status: 400, headers: { "content-type": "application/json" } }))
    );
    render(<App />);
    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
  });

  it.each([
    ["approved", "CLI authorized"],
    ["denied", "Authorization denied"]
  ])("restores an already-%s authorization", async (status, heading) => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ user: account }), { status: 200, headers: { "content-type": "application/json" } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ authorization: { userCode: "WDJF-XZPL", status } }), { status: 200, headers: { "content-type": "application/json" } }))
    );
    render(<App />);
    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
  });
});
