import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const user = { id: "user-1", name: "Ada", email: "ada@example.com" };

describe("public Web routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.querySelector('link[rel="canonical"]')?.remove();
    document.querySelector('meta[name="robots"]')?.remove();
    window.history.replaceState(null, "", "/");
  });

  it("renders Gallery while the public Session check is pending", async () => {
    let resolveSession!: (response: Response) => void;
    const session = new Promise<Response>((resolve) => {
      resolveSession = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/users/me"
          ? session
          : json({ items: [], nextCursor: null }),
      ),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Gallery" })).toBeVisible();
    expect(document.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();

    resolveSession(unauthenticated());
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });

  it("keeps a signed-in User on Gallery and projects account navigation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/users/me"
          ? json({ user })
          : json({ items: [], nextCursor: null }),
      ),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Gallery" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "My Artifacts" })).toHaveAttribute(
      "href",
      "/artifacts",
    );
    expect(screen.getByRole("button", { name: "Open account menu" })).toBeVisible();
    expect(window.location.pathname).toBe("/");
  });

  it("keeps public Gallery in place after sign out", async () => {
    const interaction = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/users/me") return json({ user });
        if (path === "/api/sessions/current" && init?.method === "DELETE")
          return new Response(null, { status: 204 });
        return json({ items: [], nextCursor: null });
      }),
    );

    render(<App />);
    await interaction.click(
      await screen.findByRole("button", { name: "Open account menu" }),
    );
    await interaction.click(
      await screen.findByRole("menuitem", { name: "Sign out" }),
    );

    expect(await screen.findByRole("link", { name: "Sign in" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Gallery" })).toBeVisible();
    expect(window.location.pathname + window.location.search).toBe("/");
  });

  it("does not alias the former Gallery index", async () => {
    window.history.replaceState(null, "", "/gallery");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(window.location.pathname).toBe("/gallery");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex,nofollow",
    );
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("treats an obsolete root account view as Gallery", async () => {
    window.history.replaceState(null, "", "/?view=login");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/users/me"
          ? unauthenticated()
          : json({ items: [], nextCursor: null }),
      ),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Gallery" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("?view=login");
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${window.location.origin}/`,
    );
  });

  it("redirects a signed-in account-entry visitor to Artifacts", async () => {
    window.history.replaceState(null, "", "/sign-in");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/users/me"
          ? json({ user })
          : json({ artifacts: [] }),
      ),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Artifacts" })).toBeVisible();
    expect(window.location.pathname).toBe("/artifacts");
  });

  it("cleans public metadata when navigating to account entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/users/me"
          ? unauthenticated()
          : json({ items: [], nextCursor: null }),
      ),
    );
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Gallery" })).toBeVisible();
    expect(document.querySelector('link[rel="canonical"]')).not.toBeNull();

    window.history.pushState(null, "", "/sign-in");
    fireEvent(window, new PopStateEvent("popstate"));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex,nofollow",
    );
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("removes indexing metadata when Gallery is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/users/me"
          ? unauthenticated()
          : json(
              {
                error: {
                  code: "gallery_unavailable",
                  message: "Gallery is unavailable.",
                },
              },
              503,
            ),
      ),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Gallery is temporarily unavailable." }),
    ).toBeVisible();
    await waitFor(() =>
      expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
        "content",
        "noindex,nofollow",
      ),
    );
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function unauthenticated() {
  return json(
    {
      error: {
        code: "unauthenticated",
        message: "Sign in to continue.",
        requestId: "req-session",
      },
    },
    401,
  );
}
