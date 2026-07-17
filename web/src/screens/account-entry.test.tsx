import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

describe("account entry screens", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/sign-up");
  });

  it("shows the focused sign-up form", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Create account" })).toBeInTheDocument();
    expect(screen.getByRole("main").querySelector('[data-slot="card"]')).toBeInTheDocument();
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
      if (path === "/api/users/me") return unauthenticated();
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

    await user.type(await screen.findByLabelText("Name"), "Ada");
    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText(/a\*\*\*@example.com/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send again in/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use a different email" })).toHaveAttribute("type", "button");
    await user.type(screen.getByLabelText("Verification code"), "123 456");
    await user.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByRole("heading", { name: "Email verified" })).toBeInTheDocument();
  });

  it("opens the neutral password-reset code state", async () => {
    window.history.replaceState(null, "", "/reset-password");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/users/me"
        ? unauthenticated()
        : new Response(JSON.stringify({
            verification: { id: "reset-1", destination: "u***@example.com", expiresIn: 600, resendAvailableIn: 60 }
          }), { status: 202, headers: { "content-type": "application/json" } })));
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText("Email"), "unknown@example.com");
    await user.click(screen.getByRole("button", { name: "Send verification code" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText(/u\*\*\*@example.com/)).toBeInTheDocument();
  });

  it("completes password reset and returns to login", async () => {
    window.history.replaceState(null, "", "/reset-password");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/users/me") return unauthenticated();
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

    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send verification code" }));
    await user.type(await screen.findByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(await screen.findByLabelText("New password"), "new-password");
    await user.type(screen.getByLabelText("Confirm new password"), "new-password");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("heading", { name: "Password reset" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  });

  it("shows field feedback for invalid sign-up input", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter a name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
  });

  it("maps server sign-up fields back to their controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/users/me" ? unauthenticated() : new Response(
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

    await user.type(await screen.findByLabelText("Name"), "A".repeat(121));
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(await screen.findByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter a shorter name.")).toBeInTheDocument();
    expect(screen.queryByText("Invalid request.")).not.toBeInTheDocument();
  });

  it("keeps Signup open and marks an occupied email", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/users/me" ? unauthenticated() : new Response(
          JSON.stringify({
            error: {
              code: "email_already_registered",
              message: "An account already exists for this email.",
              requestId: "req_occupied"
            }
          }),
          { status: 409, headers: { "content-type": "application/json" } }
        )
      )
    );
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText("Name"), "Ada Again");
    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(await screen.findByRole("button", { name: "Create account" }));

    expect(await screen.findByText("This email address is already in use. Use a different email.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("heading", { name: "Create account" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Check your email" })).not.toBeInTheDocument();
  });

  it("shows neutral feedback for failed login", async () => {
    window.history.replaceState(null, "", "/sign-in");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/users/me" ? unauthenticated() : new Response(
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

    expect(await screen.findByText("Forgot password?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/sign-up");
    expect(screen.getByText("Bring your team’s best thinking together and keep sharing as it evolves.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "unknown@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Email or password is incorrect.")).toBeInTheDocument();
    expect(screen.queryByText(/signed in/i)).not.toBeInTheDocument();
  });

  it("uses neutral feedback for request-validation login failures", async () => {
    window.history.replaceState(null, "", "/sign-in");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/users/me" ? unauthenticated() : new Response(
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

    await user.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Email or password is incorrect.")).toBeInTheDocument();
    expect(screen.queryByText("Invalid request.")).not.toBeInTheDocument();
  });

  it("opens the Artifact list after successful login", async () => {
    window.history.replaceState(null, "", "/sign-in");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/users/me") return unauthenticated();
        if (path === "/api/artifacts") {
          return new Response(JSON.stringify({ artifacts: [] }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ signedIn: true, user: { id: "user_1", name: "Ada", email: "ada@example.com" } }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await user.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Artifacts" }, { timeout: 3000 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/console");
    expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument();
  });

  it("returns to an allowed Gallery destination after sign in", async () => {
    window.history.replaceState(null, "", "/sign-in?returnTo=%2F");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/users/me") return unauthenticated();
        if (path === "/api/sessions") {
          return new Response(JSON.stringify({ signedIn: true, user: { id: "user_1", name: "Ada", email: "ada@example.com" } }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const interaction = userEvent.setup();
    render(<App />);

    await interaction.type(await screen.findByLabelText("Email"), "ada@example.com");
    await interaction.type(screen.getByLabelText("Password"), "password123");
    await interaction.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "The gallery for interactive Artifacts" })).toBeVisible();
    expect(window.location.pathname + window.location.search).toBe("/");
  });

  it("ignores an unsafe return destination after sign in", async () => {
    window.history.replaceState(
      null,
      "",
      `/sign-in?returnTo=${encodeURIComponent("//evil.example/steal")}`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/users/me") return unauthenticated();
        if (path === "/api/artifacts") {
          return new Response(JSON.stringify({ artifacts: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ signedIn: true, user: { id: "user_1", name: "Ada", email: "ada@example.com" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const interaction = userEvent.setup();
    render(<App />);

    await interaction.type(await screen.findByLabelText("Email"), "ada@example.com");
    await interaction.type(screen.getByLabelText("Password"), "password123");
    await interaction.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Artifacts" })).toBeVisible();
    expect(window.location.pathname).toBe("/console");
  });
});

function unauthenticated() {
  return new Response(
    JSON.stringify({
      error: {
        code: "unauthenticated",
        message: "Sign in to continue.",
        requestId: "req_session",
      },
    }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
}
