import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const user = { id: "user-1", name: "Ada", email: "ada@example.com" };

describe("public Website routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.querySelector('link[rel="canonical"]')?.remove();
    document.querySelector('meta[name="robots"]')?.remove();
    window.history.replaceState(null, "", "/");
  });

  it("renders Website while the public Session check is pending", async () => {
    let resolveSession!: (response: Response) => void;
    const session = new Promise<Response>((resolve) => { resolveSession = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/users/me" ? session : json({ items: [], nextCursor: null }),
    ));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "The gallery for interactive Artifacts" })).toBeVisible();
    expect(within(screen.getByRole("banner")).queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    resolveSession(unauthenticated());
    expect(await within(screen.getByRole("banner")).findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  });

  it("keeps a signed-in User on Website and projects Console navigation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/users/me" ? json({ user }) : json({ items: [], nextCursor: null }),
    ));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "The gallery for interactive Artifacts" })).toBeVisible();
    expect(await within(screen.getByRole("banner")).findByRole("link", { name: "My Artifacts" })).toHaveAttribute("href", "/console");
    expect(screen.getByRole("button", { name: "Open account menu" })).toBeVisible();
    expect(window.location.pathname).toBe("/");
  });

  it("uses real search and Gallery cards as the homepage product evidence", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/users/me") return unauthenticated();
      return json({
        items: [{
          slug: "budget-map",
          title: "Budget Map",
          description: "A practical budget tool.",
          tags: ["finance"],
          createdAt: "2026-01-02T00:00:00.000Z",
          creator: { slug: "maker", displayName: "Maker" },
          cover: { state: "placeholder", url: null },
        }],
        nextCursor: null,
      });
    }));

    render(<App />);

    const heading = await screen.findByRole("heading", { name: "The gallery for interactive Artifacts" });
    expect(heading.closest("section")).toHaveClass("from-muted/45", "to-background");
    const main = screen.getByRole("main");
    const search = within(main).getByRole("search");
    expect(search).toHaveAttribute("action", "/browse");
    expect(within(search).getByRole("textbox", { name: "Search Gallery" })).toHaveAttribute("name", "q");
    expect(within(search).getByRole("button", { name: "Explore" })).toBeVisible();
    expect(await within(main).findByRole("heading", { name: "Budget Map" })).toBeVisible();
    const ownershipLocation = `/sign-in?returnTo=${encodeURIComponent("/console")}`;
    expect(within(main).getAllByRole("link", { name: /Start publishing/ }).every((link) => link.getAttribute("href") === ownershipLocation)).toBe(true);
    for (const unsupported of ["Open app", "Categories", "Trending", "Most played", "Editor's pick"]) {
      expect(screen.queryByText(unsupported)).not.toBeInTheDocument();
    }
  });

  it("reserves a bounded Gallery region while homepage discovery loads", async () => {
    const gallery = new Promise<Response>(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/users/me" ? unauthenticated() : gallery,
    ));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "The gallery for interactive Artifacts" })).toBeVisible();
    expect(screen.getByLabelText("Loading Gallery discovery")).toHaveClass("min-h-[430px]", "grid-cols-4");
    expect(screen.getByRole("search", { name: "" })).toBeVisible();
  });

  it("keeps Website in place after sign out", async () => {
    const interaction = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/users/me") return json({ user });
      if (path === "/api/sessions/current" && init?.method === "DELETE") return new Response(null, { status: 204 });
      return json({ items: [], nextCursor: null });
    }));

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Open account menu" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Sign out" }));

    expect(await within(screen.getByRole("banner")).findByRole("link", { name: "Sign in" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "The gallery for interactive Artifacts" })).toBeVisible();
    expect(window.location.pathname + window.location.search).toBe("/");
  });

  it("does not alias the former Gallery index", async () => {
    window.history.replaceState(null, "", "/gallery");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("does not treat an obsolete root account view as account entry", async () => {
    window.history.replaceState(null, "", "/?view=login");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/users/me" ? unauthenticated() : json({ items: [], nextCursor: null }),
    ));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "The gallery for interactive Artifacts" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("redirects a signed-in account-entry visitor to Console", async () => {
    window.history.replaceState(null, "", "/sign-in");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/users/me" ? json({ user }) : json({ artifacts: [] }),
    ));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Artifacts" }, { timeout: 3000 })).toBeVisible();
    expect(window.location.pathname).toBe("/console");
  });

  it("clears public metadata synchronously when navigating to account entry", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/users/me" ? unauthenticated() : json({ items: [], nextCursor: null }),
    ));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "The gallery for interactive Artifacts" })).toBeVisible();
    expect(document.querySelector('link[rel="canonical"]')).not.toBeNull();

    window.history.pushState(null, "", "/sign-in");
    fireEvent(window, new PopStateEvent("popstate"));

    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  it("keeps Website canonical and removes Gallery evidence when Gallery is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/users/me" ? unauthenticated() : json({ error: { code: "gallery_unavailable", message: "Gallery is unavailable." } }, 503),
    ));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Community discovery is taking a pause." })).toBeVisible();
    expect(screen.queryAllByRole("link", { name: "Browse" })).toHaveLength(0);
    expect(screen.queryByRole("textbox", { name: "Search Gallery" })).not.toBeInTheDocument();
    expect(screen.queryByText("Featured")).not.toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "index,follow"));
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", `${window.location.origin}/`);
  });

  it("uses Newest only after an eligible empty Featured result", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/users/me") return unauthenticated();
      requests.push(path);
      return json({ items: [], nextCursor: null });
    }));
    render(<App />);
    expect(await screen.findByText("No public Artifacts are available yet.")).toBeVisible();
    expect(requests).toEqual(["/gallery/featured?limit=8", "/gallery/newest?limit=8"]);
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function unauthenticated() {
  return json({ error: { code: "unauthenticated", message: "Sign in to continue.", requestId: "req-session" } }, 401);
}
