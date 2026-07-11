import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

describe("account entry screens", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/?view=register");
  });

  it("shows dedicated register form without deferred actions", () => {
    render(<App />);

    expect(screen.getByRole("main").querySelector('[data-slot="card"]')).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Give Every Idea An Audience" })).toBeInTheDocument();
    expect(screen.getByText("Bring your team’s best thinking together and keep sharing as it evolves.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(["password", "reset"].join(" "), "i"))).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(["goo", "gle"].join(""), "i"))).not.toBeInTheDocument();
  });

  it("shows field feedback for invalid registration input", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter a name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
  });

  it("maps server registration fields back to their controls", async () => {
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
    await user.click(screen.getByRole("button", { name: "Create account" }));

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

    expect(screen.queryByText(/forgot/i)).not.toBeInTheDocument();
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
