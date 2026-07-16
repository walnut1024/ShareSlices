import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

describe("account entry screens", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/?view=signup");
  });

  it("shows the focused sign-up form", () => {
    render(<App />);

    expect(screen.getByRole("main").querySelector('[data-slot="card"]')).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign up" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Give Every Idea An Audience" })).toBeInTheDocument();
    expect(screen.getByText("Bring your team’s best thinking together and keep sharing as it evolves.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(["password", "reset"].join(" "), "i"))).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(["goo", "gle"].join(""), "i"))).not.toBeInTheDocument();
  });

  it("enters and completes sign-up email verification", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/verify")) {
        return new Response(JSON.stringify({ verified: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({
        verification: { id: "verification-1", destination: "a***@example.com", expiresIn: 600, resendAvailableIn: 60 }
      }), { status: 202, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText(/a\*\*\*@example.com/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send again in/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use a different email" })).toHaveAttribute("type", "button");
    await user.type(screen.getByLabelText("Verification code"), "123 456");
    await user.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByRole("heading", { name: "Email verified" })).toBeInTheDocument();
  });

  it("opens the neutral password-reset code state", async () => {
    window.history.replaceState(null, "", "/?view=reset");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      verification: { id: "reset-1", destination: "u***@example.com", expiresIn: 600, resendAvailableIn: 60 }
    }), { status: 202, headers: { "content-type": "application/json" } })));
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Email"), "unknown@example.com");
    await user.click(screen.getByRole("button", { name: "Send verification code" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText(/u\*\*\*@example.com/)).toBeInTheDocument();
  });

  it("completes password reset and returns to login", async () => {
    window.history.replaceState(null, "", "/?view=reset");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/verify")) {
        return new Response(JSON.stringify({ resetGrant: "grant-1", expiresIn: 600 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (path === "/api/password-resets") {
        return new Response(JSON.stringify({ reset: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({
        verification: { id: "reset-1", destination: "a***@example.com", expiresIn: 600, resendAvailableIn: 60 }
      }), { status: 202, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send verification code" }));
    await user.type(await screen.findByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(await screen.findByLabelText("New password"), "new-password");
    await user.type(screen.getByLabelText("Confirm new password"), "new-password");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("heading", { name: "Password reset" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/?view=login");
  });

  it("shows field feedback for invalid sign-up input", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(await screen.findByText("Enter a name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
  });

  it("maps server sign-up fields back to their controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "invalid_request",
              message: "Invalid request.",
              requestId: "req_1",
              fields: [{ path: "name", code: "invalid_name", message: "Enter a shorter name." }]
            }
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" }
          }
        )
      )
    );

    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Name"), "A".repeat(121));
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(await screen.findByText("Enter a shorter name.")).toBeInTheDocument();
    expect(screen.queryByText("Invalid request.")).not.toBeInTheDocument();
  });

  it("shows neutral feedback for failed login", async () => {
    window.history.replaceState(null, "", "/?view=login");
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

    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText("Forgot password?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/?view=signup");
    expect(screen.getByText("Bring your team’s best thinking together and keep sharing as it evolves.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "unknown@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Email or password is incorrect.")).toBeInTheDocument();
    expect(screen.queryByText(/signed in/i)).not.toBeInTheDocument();
  });

  it("uses neutral feedback for request-validation login failures", async () => {
    window.history.replaceState(null, "", "/?view=login");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { code: "invalid_request", message: "Invalid request.", requestId: "req_1" }
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" }
          }
        )
      )
    );

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Email or password is incorrect.")).toBeInTheDocument();
    expect(screen.queryByText("Invalid request.")).not.toBeInTheDocument();
  });

  it("opens the Artifact list after successful login", async () => {
    window.history.replaceState(null, "", "/?view=login");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ signedIn: true, user: { id: "user_1", name: "Ada", email: "ada@example.com" } }), {
          status: 201,
          headers: { "content-type": "application/json" }
        })
      )
    );

    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { name: "Artifacts" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/artifacts");
    expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument();
  });
});
