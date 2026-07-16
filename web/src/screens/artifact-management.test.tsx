import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const preflightArtifactZip = vi.hoisted(() => vi.fn());
vi.mock("../artifacts/archive-preflight-client", () => ({ preflightArtifactZip }));

const user = { id: "user-1", name: "Ada", email: "ada@example.com" };
const storedPreferences = new Map<string, string>();

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storedPreferences.get(key) ?? null,
    setItem: (key: string, value: string) => storedPreferences.set(key, value),
    removeItem: (key: string) => storedPreferences.delete(key),
    clear: () => storedPreferences.clear()
  }
});

describe("Artifact management", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    storedPreferences.clear();
    preflightArtifactZip.mockReset();
    preflightArtifactZip.mockResolvedValue({ primaryIssue: null, issues: [], warnings: [] });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    Reflect.deleteProperty(document, "exitFullscreen");
    Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
  });

  it("routes an authenticated user to the Artifact list", async () => {
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [artifact({ processingState: "processing", allowedActions: ["rename", "copy_share_link"] })] })
    ]);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Artifacts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gallery" })).toHaveAttribute("href", "/gallery");
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Report" })).toHaveAttribute("href", "/artifacts/artifact-1");
    expect(screen.getByText("Processing")).toBeInTheDocument();
  });

  it("renders management chrome and Artifact tiles with shadcn components", async () => {
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [artifact({ allowedActions: ["rename", "copy_share_link"] })] })
    ]);

    render(<App />);

    const artifactLink = await screen.findByRole("link", { name: "Report" });
    const artifactCard = artifactLink.closest('[data-slot="card"]');
    const artifactGrid = artifactCard?.closest("ul");
    const preview = artifactCard?.querySelector('[data-slot="aspect-ratio"]');
    const footer = artifactCard?.querySelector('[data-slot="card-footer"]');
    expect(document.querySelector('[data-slot="avatar"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="toggle-group"]')).toBeInTheDocument();
    expect(screen.getByTestId("artifacts-page")).toHaveClass("mx-auto", "w-full", "max-w-[1920px]");
    expect(artifactGrid).toHaveClass("grid-cols-[repeat(auto-fill,minmax(310px,1fr))]", "gap-5");
    expect(artifactCard).toHaveClass("shadow-[0_1px_2px_rgba(9,9,11,0.05)]");
    expect(artifactCard?.parentElement).not.toHaveAttribute("data-slot", "aspect-ratio");
    expect(preview).toHaveStyle({ "--ratio": `${16 / 9}` });
    expect(footer).toHaveClass("min-h-16");
    expect(screen.getByText("Accepted").closest(".group\\/badge")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions for Report" })).toHaveClass("group/button");
  });

  it("preserves the head and tail of a long grid card name", async () => {
    const longName = "腾讯文档盘点分析报告-123456789012345678901234567890-2026最终版";
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([json({ user }), json({ artifacts: [artifact({ name: longName })] })]);

    render(<App />);

    const card = (await screen.findByRole("link", { name: longName })).closest<HTMLElement>('[data-slot="card"]')!;
    const displayedName = within(card).getByTitle(longName);
    expect(displayedName.textContent).toBe(longName);
    expect(displayedName.firstElementChild).toHaveClass("text-ellipsis");
    expect(displayedName.lastElementChild).toHaveTextContent("234567890-2026最终版");
    expect(displayedName).toHaveAttribute("title", longName);
  });

  it("shows only a completed latest-ready thumbnail in grid view", async () => {
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [artifact({
        processingState: "ready",
        readyVersion: { id: "version/1", state: "ready", thumbnailState: "ready" },
        allowedActions: ["preview"]
      })] })
    ]);

    render(<App />);

    const card = (await screen.findByRole("link", { name: "Report" })).closest<HTMLElement>('[data-slot="card"]')!;
    const thumbnail = card.querySelector("img");
    expect(thumbnail).toHaveAttribute("src", "/api/versions/version%2F1/thumbnail");
    expect(thumbnail).toHaveClass("object-cover");
    expect(within(card).getByRole("link", { name: "Preview Report" })).toHaveAttribute("href", "/artifacts/artifact-1/preview?versionId=version%2F1");
    expect(within(card).getByRole("link", { name: "Preview Report" })).toHaveAttribute("target", "_blank");
    expect(within(card).getByRole("link", { name: "Preview Report" })).toHaveAttribute("rel", "noopener");
    expect(within(card).getByRole("button", { name: "Enter full screen for Report" })).toBeInTheDocument();
  });

  it("enters Card full screen directly and restores unchanged management state on exit", async () => {
    const interaction = userEvent.setup();
    let fullscreenElement: Element | null = null;
    let requestTarget: HTMLElement | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      })
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn(async function (this: HTMLElement) {
        requestTarget = this;
        fullscreenElement = this;
      })
    });
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [artifact({ processingState: "ready", readyVersion: { id: "version/1", state: "ready" }, allowedActions: ["preview"] })] })
    ]);

    render(<App />);
    const search = await screen.findByRole("textbox", { name: "Search artifacts" });
    await interaction.type(search, "report");
    const button = screen.getByRole("button", { name: "Enter full screen for Report" });
    const card = button.closest<HTMLElement>('[data-slot="card"]')!;
    await interaction.click(button);

    expect(requestTarget).toBe(card);
    expect(await screen.findByTitle("Artifact content")).toHaveAttribute("src", "/api/versions/version%2F1/content/");
    expect(window.location.pathname).toBe("/artifacts");
    expect(search).toHaveValue("report");

    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    await waitFor(() => expect(screen.queryByTitle("Artifact content")).not.toBeInTheDocument());
    expect(search).toHaveValue("report");
  });

  it("reports a rejected Card full-screen request without navigation", async () => {
    const interaction = userEvent.setup();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new TypeError("Denied"))
    });
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [artifact({ processingState: "ready", readyVersion: { id: "version-1", state: "ready" }, allowedActions: ["preview"] })] })
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Enter full screen for Report" }));

    expect(await screen.findByText("Full screen could not be opened.")).toBeInTheDocument();
    expect(screen.queryByTitle("Artifact content")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/artifacts");
  });

  it("omits Card full screen from list view and selection mode", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [artifact({ processingState: "ready", readyVersion: { id: "version-1", state: "ready" }, allowedActions: ["preview"] })] })
    ]);

    render(<App />);
    expect(await screen.findByRole("button", { name: "Enter full screen for Report" })).toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.queryByRole("button", { name: "Enter full screen for Report" })).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Grid view" }));
    await interaction.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.queryByRole("button", { name: "Enter full screen for Report" })).not.toBeInTheDocument();
  });

  it("hides grid card actions that the server does not allow", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [artifact({ processingState: "ready", readyVersion: { id: "version-1", state: "ready" }, allowedActions: [] })] })
    ]);

    render(<App />);

    await screen.findByRole("link", { name: "Report" });
    expect(screen.queryByRole("button", { name: "Enter full screen for Report" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share Report" })).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "More actions for Report" }));
    expect(await screen.findByRole("menuitem", { name: "Info" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument();
  });

  it("keeps Share with link and Share to Gallery as separate actions", async () => {
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [artifact({ processingState: "ready", readyVersion: { id: "version-1", state: "ready" }, allowedActions: ["publish"] })] })
    ]);

    render(<App />);
    expect(await screen.findByRole("button", { name: "Share with link Report" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share Report to Gallery" })).toBeInTheDocument();
  });

  it("shows the current identity and Sign out in the avatar menu", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([json({ user }), json({ artifacts: [] })]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Open account menu" }));

    expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
    expect(await screen.findByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("signs out and replaces the management location with Log in", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    const fetchMock = stubFetch([json({ user }), json({ artifacts: [] }), new Response(null, { status: 204 })]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Open account menu" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe("/?view=login");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/sessions/current",
      expect.objectContaining({ method: "DELETE", credentials: "include" })
    );
  });

  it("treats an expired Session as signed out", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [] }),
      json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, 401)
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Open account menu" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe("/?view=login");
  });

  it("keeps the user signed in and shows neutral feedback when sign out fails", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [] }),
      json({ error: { code: "internal_error", message: "Internal server error." } }, 500)
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Open account menu" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Sign out" }));

    expect(await screen.findByText("Could not sign out. Try again.")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/artifacts");
    expect(screen.getByRole("heading", { name: "Artifacts" })).toBeInTheDocument();
  });

  it("prevents another sign-out request while one is pending", async () => {
    const interaction = userEvent.setup();
    let resolveSignOut!: (response: Response) => void;
    const pendingSignOut = new Promise<Response>((resolve) => {
      resolveSignOut = resolve;
    });
    const responses: Array<Response | Promise<Response>> = [json({ user }), json({ artifacts: [] }), pendingSignOut];
    const fetchMock = vi.fn(async () => {
      const response = responses.shift();
      if (!response) throw new Error("Unexpected fetch call.");
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/artifacts");

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Open account menu" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    await interaction.click(screen.getByRole("button", { name: "Open account menu" }));

    expect(await screen.findByRole("menuitem", { name: "Sign out" })).toHaveAttribute("data-disabled");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    resolveSignOut(new Response(null, { status: 204 }));
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });

  it("filters and searches the Artifact tile grid", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({
        artifacts: [
          artifact({ id: "artifact-ready", name: "Launch brief", processingState: "ready", readyVersion: { id: "version-1", state: "ready" } }),
          artifact({ id: "artifact-live", name: "Board deck", processingState: "ready", readyVersion: { id: "version-2", state: "ready" }, publication: { id: "publication-1", versionId: "version-2", publishedAt: "2026-07-10T00:00:00.000Z" } }),
          artifact({ id: "artifact-processing", name: "Pricing", processingState: "processing" })
        ]
      })
    ]);

    render(<App />);

    await screen.findByRole("link", { name: "Launch brief" });
    await interaction.click(screen.getByRole("button", { name: "Filter" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Published" }));
    expect(screen.getByRole("link", { name: "Board deck" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Launch brief" })).not.toBeInTheDocument();

    await interaction.click(screen.getByRole("button", { name: "Filter" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "All artifacts" }));
    await interaction.type(screen.getByRole("textbox", { name: "Search artifacts" }), "pricing");
    expect(screen.getByRole("link", { name: "Pricing" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Board deck" })).not.toBeInTheDocument();
  });

  it("distinguishes the first-use empty state from an empty search result", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([json({ user }), json({ artifacts: [] })]);

    const { unmount } = render(<App />);

    expect(await screen.findByRole("heading", { name: "No artifacts yet" })).toBeInTheDocument();
    expect(screen.getByText("Upload your first artifact to start sharing.")).toBeInTheDocument();
    expect(screen.getByText("Drag and drop a ZIP or self-contained HTML file here, or use the button below.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New artifact" })).toHaveLength(2);

    fireEvent.drop(document.querySelector('[data-slot="empty"]')!, {
      dataTransfer: { files: [new File(["zip"], "site.zip", { type: "application/zip" })] }
    });
    expect(await screen.findByRole("dialog")).toHaveTextContent("site.zip");

    unmount();
    stubFetch([json({ user }), json({ artifacts: [artifact({ name: "Launch brief" })] })]);
    render(<App />);
    await screen.findByRole("link", { name: "Launch brief" });
    await interaction.type(screen.getByRole("textbox", { name: "Search artifacts" }), "missing");

    expect(screen.getByRole("heading", { name: "No artifacts found" })).toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(screen.getByRole("link", { name: "Launch brief" })).toBeInTheDocument();
  });

  it("keeps selected Artifacts across views and selects only the filtered results", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({
        artifacts: [
          artifact({ id: "artifact-alpha", name: "Alpha", allowedActions: ["publish", "delete"] }),
          artifact({ id: "artifact-beta", name: "Beta", allowedActions: ["publish", "delete"] }),
          artifact({ id: "artifact-gamma", name: "Gamma", allowedActions: ["publish", "delete"] })
        ]
      })
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Select" }));
    await interaction.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();

    await interaction.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).toBeChecked();
    await interaction.type(screen.getByRole("textbox", { name: "Search artifacts" }), "beta");
    await interaction.click(screen.getByRole("button", { name: "Select all 1" }));

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Beta" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Select Gamma" })).not.toBeInTheDocument();

    await interaction.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });

  it("restores the saved Artifact view", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([json({ user }), json({ artifacts: [artifact({ name: "Launch brief" })] })]);

    const firstRender = render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "List view" }));
    expect(storedPreferences.get("shareslices.artifacts.view.v1")).toBe("list");
    expect(document.querySelector('[data-slot="table"]')).toBeInTheDocument();

    firstRender.unmount();
    stubFetch([json({ user }), json({ artifacts: [artifact({ name: "Launch brief" })] })]);
    render(<App />);
    await screen.findByRole("link", { name: "Launch brief" });
    expect(document.querySelector('[data-slot="table"]')).toBeInTheDocument();
  });

  it("explains an ineligible batch Publish with Sonner without making a request", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    const fetchMock = stubFetch([
      json({ user }),
      json({
        artifacts: [
          artifact({ id: "artifact-ready", name: "Ready", processingState: "ready", readyVersion: { id: "version-ready", state: "ready" }, allowedActions: ["publish"] }),
          artifact({ id: "artifact-processing", name: "Processing", processingState: "processing", allowedActions: [] })
        ]
      })
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Select" }));
    await interaction.click(screen.getByRole("button", { name: "Select all 2" }));
    await interaction.click(screen.getByRole("button", { name: "Share with link" }));

    expect(await screen.findByText(/1 selected artifact cannot be published/i)).toBeInTheDocument();
    expect(screen.getByText(/still processing/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("blocks batch Publish when an allowed Artifact has no ready Version", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    const fetchMock = stubFetch([
      json({ user }),
      json({ artifacts: [artifact({ name: "Incomplete", processingState: "ready", readyVersion: null, allowedActions: ["publish"] })] })
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Select" }));
    await interaction.click(screen.getByRole("checkbox", { name: "Select Incomplete" }));
    await interaction.click(screen.getByRole("button", { name: "Share with link" }));

    expect(await screen.findByText(/has no ready Version/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("publishes selected Artifacts with one access period and retains a runtime failure", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    const fetchMock = stubFetch([
      json({ user }),
      json({
        artifacts: [
          artifact({ id: "artifact-alpha", name: "Alpha", processingState: "ready", readyVersion: { id: "version-alpha", state: "ready" }, allowedActions: ["publish"] }),
          artifact({ id: "artifact-beta", name: "Beta", processingState: "ready", readyVersion: { id: "version-beta", state: "ready" }, allowedActions: ["publish"] })
        ]
      }),
      json({
        artifact: artifact({
          id: "artifact-alpha",
          name: "Alpha",
          processingState: "ready",
          readyVersion: { id: "version-alpha", state: "ready" },
          publicationStatus: "published",
          publication: { ...publication(), versionId: "version-alpha" },
          shareLink: { url: "https://view.example.test/a/alpha/", state: "active" },
          allowedActions: ["manage_publication", "copy_share_link", "unpublish"]
        }),
        publication: { ...publication(), versionId: "version-alpha" },
        shareLink: { url: "https://view.example.test/a/alpha/", state: "active" }
      }, 201),
      json({ error: { code: "publication_conflict", message: "Beta changed while publishing." } }, 409)
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Select" }));
    await interaction.click(screen.getByRole("button", { name: "Select all 2" }));
    await interaction.click(screen.getByRole("button", { name: "Share with link" }));
    expect(await screen.findByRole("heading", { name: "Share 2 Artifacts with links" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Generate a new Share link")).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("combobox", { name: "Access period" }));
    await interaction.click(await screen.findByRole("option", { name: "7 days" }));
    await interaction.click(screen.getByRole("button", { name: "Share 2 with links" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/artifacts/artifact-alpha/publications",
      expect.objectContaining({ body: JSON.stringify({ versionId: "version-alpha", expiration: { kind: "duration", durationSeconds: 604800 }, link: { mode: "reuse" } }) })
    ));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/artifacts/artifact-beta/publications",
      expect.objectContaining({ body: JSON.stringify({ versionId: "version-beta", expiration: { kind: "duration", durationSeconds: 604800 }, link: { mode: "reuse" } }) })
    );
    expect(await screen.findByText(/1 published, 1 failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Beta changed while publishing/i)).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Beta" })).toBeChecked();
  });

  it("confirms batch Delete and keeps only runtime failures selected", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    const fetchMock = stubFetch([
      json({ user }),
      json({
        artifacts: [
          artifact({ id: "artifact-alpha", name: "Alpha", allowedActions: ["delete"] }),
          artifact({ id: "artifact-beta", name: "Beta", allowedActions: ["delete"] })
        ]
      }),
      new Response(null, { status: 204 }),
      json({ error: { code: "artifact_busy", message: "Beta is busy." } }, 409)
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Select" }));
    await interaction.click(screen.getByRole("button", { name: "Select all 2" }));
    await interaction.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("heading", { name: "Delete 2 Artifacts?" })).toBeInTheDocument();
    expect(screen.getByText(/Share links, Gallery proposals, and Gallery URLs/i)).toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Delete 2 artifacts" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/artifact-alpha", expect.objectContaining({ method: "DELETE" })));
    expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/artifact-beta", expect.objectContaining({ method: "DELETE" }));
    expect(await screen.findByText(/1 deleted, 1 failed/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Alpha" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Beta" })).toBeChecked();
  });

  it("sends an unauthenticated management visitor to log in", async () => {
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([json({ error: { code: "unauthenticated", message: "Sign in required.", requestId: "req-1" } }, 401)]);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });

  it("shows detail state and only server-allowed actions", async () => {
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([
      json({ user }),
      json({
        artifact: artifact({
          processingState: "ready",
          readyVersion: { id: "version-1", state: "ready" },
          allowedActions: ["rename", "preview", "publish", "copy_share_link"]
        })
      })
    ]);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Report" })).toBeInTheDocument();
    expect(screen.getByText("Not active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Share with link" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renames an Artifact while retaining its stable ID", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([
      json({ user }),
      json({ artifact: artifact() }),
      json({ artifact: artifact({ name: "Quarterly report" }) })
    ]);

    render(<App />);

    await interaction.click(await screen.findByRole("button", { name: "Rename" }));
    const name = screen.getByLabelText("Artifact name");
    expect(name.closest('[data-slot="field"]')).toBeInTheDocument();
    await interaction.clear(name);
    await interaction.type(name, "Quarterly report");
    await interaction.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("heading", { name: "Quarterly report" })).toBeInTheDocument();
    expect(screen.getByText("artifact-1")).toBeInTheDocument();
  });

  it("validates a create form before uploading", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [] }),
      json({
        policy: {
          revision: "policy-1",
          maxArchiveBytes: 4,
          maxExpandedBytes: 100,
          maxFileCount: 10,
          maxFileBytes: 50,
          enabledExtensions: [".html"]
        }
      })
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "New artifact" }));
    await screen.findByRole("heading", { name: "New artifact" });
    expect(screen.getByText("Drop a ZIP or HTML file here").closest("label")).toHaveAttribute("data-slot", "label");
    expect(screen.queryByLabelText("Artifact name")).not.toBeInTheDocument();
    await interaction.upload(
      screen.getByLabelText("Artifact file"),
      new File(["oversized"], "report.zip", { type: "application/zip" })
    );
    await interaction.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("This ZIP exceeds the 4 B upload limit.")).toBeInTheDocument();
  });

  it("blocks create before upload when ZIP preflight finds a primary issue", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [] }),
      json({ policy: uploadPolicy() })
    ]);
    const send = vi.fn();
    vi.stubGlobal("XMLHttpRequest", class {
      upload = {};
      open() {}
      setRequestHeader() {}
      send = send;
    });
    preflightArtifactZip.mockResolvedValue({
      primaryIssue: {
        code: "unsupported_format",
        message: "A file format is not supported.",
        action: "Remove or convert the file, then upload a new ZIP.",
        details: {
          path: "notes.md",
          extension: ".md",
          actualBytes: 2,
          limitBytes: 1,
          actualCount: 3,
          limitCount: 2,
          candidates: ["a.html", "b.html"]
        }
      },
      issues: [],
      warnings: []
    });

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "New artifact" }));
    await interaction.upload(screen.getByLabelText("Artifact file"), new File(["zip"], "report.zip", { type: "application/zip" }));
    await interaction.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("A file format is not supported.")).toBeInTheDocument();
    expect(screen.getByText("Remove or convert the file, then upload a new ZIP.")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.getByText("2 B")).toBeInTheDocument();
    expect(screen.getByText("1 B")).toBeInTheDocument();
    expect(screen.getByText("3 files")).toBeInTheDocument();
    expect(screen.getByText("2 files")).toBeInTheDocument();
    expect(screen.getByText("a.html")).toBeInTheDocument();
    expect(screen.getByText("b.html")).toBeInTheDocument();
    expect(screen.getByText("A file format is not supported.").closest('[data-slot="alert"]')).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("shows a structured server upload limit rejection in the create dialog", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([json({ user }), json({ artifacts: [] }), json({ policy: uploadPolicy() })]);
    preflightArtifactZip.mockResolvedValue({ primaryIssue: null, issues: [], warnings: [] });
    vi.stubGlobal("XMLHttpRequest", class {
      status = 0;
      responseText = "";
      withCredentials = false;
      upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() {
        this.status = 413;
        this.responseText = JSON.stringify({
          error: {
            code: "archive_too_large",
            message: "ZIP exceeds the upload limit.",
            action: "Reduce the ZIP below the upload limit and try again.",
            details: { limitBytes: 52_428_800 }
          }
        });
        this.onload?.();
      }
    });

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "New artifact" }));
    await interaction.upload(screen.getByLabelText("Artifact file"), new File(["zip"], "report.zip", { type: "application/zip" }));
    await interaction.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("ZIP exceeds the upload limit.")).toBeInTheDocument();
    expect(screen.getByText("Reduce the ZIP below the upload limit and try again.")).toBeInTheDocument();
    expect(screen.getByText("50 MiB")).toBeInTheDocument();
  });

  it("continues create with neutral feedback when ZIP preflight cannot run", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [] }),
      json({ policy: uploadPolicy() }),
      json({ artifacts: [artifact()] })
    ]);
    vi.stubGlobal("XMLHttpRequest", acceptedUploadRequest());
    preflightArtifactZip.mockRejectedValue(new Error("worker failed"));

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "New artifact" }));
    await interaction.upload(screen.getByLabelText("Artifact file"), new File(["zip"], "report.zip", { type: "application/zip" }));
    await interaction.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByRole("heading", { name: "Artifacts" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Report" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/artifacts");
  });

  it("derives the Artifact name from the ZIP filename", async () => {
    const interaction = userEvent.setup();
    const send = vi.fn();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [] }),
      json({
        policy: {
          revision: "policy-1",
          maxArchiveBytes: 1_000,
          maxExpandedBytes: 2_000,
          maxFileCount: 10,
          maxFileBytes: 1_000,
          enabledExtensions: [".html"]
        }
      })
    ]);

    vi.stubGlobal("XMLHttpRequest", acceptedUploadRequest(send));
    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "New artifact" }));
    const file = screen.getByLabelText("Artifact file");

    await interaction.upload(file, new File(["zip"], "quarterly-report.zip", { type: "application/zip" }));
    expect(screen.queryByLabelText("Artifact name")).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(send).toHaveBeenCalled());
    const body = send.mock.calls[0]?.[0] as FormData;
    expect(body.get("name")).toBe("quarterly-report");
  });

  it("packages self-contained HTML before preflight and upload", async () => {
    const interaction = userEvent.setup();
    const send = vi.fn();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([json({ user }), json({ artifacts: [] }), json({ policy: uploadPolicy() })]);
    vi.stubGlobal("XMLHttpRequest", acceptedUploadRequest(send));

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "New artifact" }));
    expect(screen.getByText("Self-contained HTML files only; local assets are not collected.")).toBeInTheDocument();

    await interaction.upload(
      screen.getByLabelText("Artifact file"),
      new File(["<!doctype html><title>Quarterly report</title>"], "quarterly-report.html", { type: "text/html" })
    );
    await interaction.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(preflightArtifactZip).toHaveBeenCalledWith(
      expect.objectContaining({ name: "quarterly-report.zip", type: "application/zip" }),
      expect.anything(),
      expect.any(AbortSignal)
    );
    const body = send.mock.calls[0]?.[0] as FormData;
    expect(body.get("name")).toBe("quarterly-report");
    expect(body.get("file")).toEqual(expect.objectContaining({ name: "quarterly-report.zip", type: "application/zip" }));
  });

  it("accepts a ZIP dropped onto the file target", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([json({ user }), json({ artifacts: [] }), json({ policy: uploadPolicy() })]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "New artifact" }));
    const target = screen.getByText("Drop a ZIP or HTML file here").closest("label");
    fireEvent.drop(target!, { dataTransfer: { files: [new File(["zip"], "dropped-report.zip", { type: "application/zip" })] } });

    expect(await screen.findByText("dropped-report.zip")).toBeInTheDocument();
  });

  it("rejects a ZIP filename that cannot produce an Artifact name", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([json({ user }), json({ artifacts: [] }), json({ policy: uploadPolicy() })]);
    const send = vi.fn();
    vi.stubGlobal("XMLHttpRequest", class {
      upload = {};
      open() {}
      setRequestHeader() {}
      send = send;
    });

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "New artifact" }));
    await interaction.upload(screen.getByLabelText("Artifact file"), new File(["zip"], ".zip", { type: "application/zip" }));
    await interaction.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Rename the file before uploading.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("opens New artifact in a dialog without changing the route", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [] }),
      json({
        policy: {
          revision: "policy-1",
          maxArchiveBytes: 1_000,
          maxExpandedBytes: 2_000,
          maxFileCount: 10,
          maxFileBytes: 1_000,
          enabledExtensions: [".html"]
        }
      })
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "New artifact" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New artifact" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/artifacts");

    await interaction.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("redirects the removed New artifact route to the Artifact list", async () => {
    window.history.replaceState(null, "", "/artifacts/new");
    stubFetch([json({ user }), json({ artifacts: [] })]);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Artifacts" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/artifacts");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps accepted and published states distinct", async () => {
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([
      json({ user }),
      json({
        artifact: artifact({
          processingState: "ready",
          readyVersion: { id: "version-1", state: "ready" },
          publication: publication(),
          allowedActions: ["rename", "preview", "manage_publication", "unpublish", "copy_share_link"]
        })
      })
    ]);

    render(<App />);

    expect(await screen.findByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage link" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Share with link" })).not.toBeInTheDocument();
  });

  it("shows Restricted independently and keeps only non-expanding sharing management", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([
      json({ user }),
      json({
        artifact: artifact({
          processingState: "ready",
          readyVersion: { id: "version-1", state: "ready" },
          publication: publication(),
          publicationStatus: "published",
          publicSharingRestriction: { state: "restricted" },
          allowedActions: ["rename", "preview", "manage_publication", "unpublish", "export", "delete"]
        })
      })
    ]);

    render(<App />);

    expect(await screen.findByText("Restricted")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy Share link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share with link" })).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Manage link" }));
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Save link settings" })).not.toBeInTheDocument();
  });

  it("shows a failed upload summary and only its allowed recovery action", async () => {
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([
      json({ user }),
      json({
        artifact: artifact({
          processingState: "failed",
          failure: { code: "object_storage_unavailable", message: "Processing could not reach storage.", recoverable: true },
          allowedActions: ["rename", "retry", "copy_share_link"]
        })
      })
    ]);

    render(<App />);

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Processing could not reach storage.")).toBeInTheDocument();
    expect(screen.getByText("Retry processes the same ZIP again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Replace file" })).not.toBeInTheDocument();
  });

  it("returns an accepted upload to Artifact management", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [] }),
      json({
        policy: {
          revision: "policy-1",
          maxArchiveBytes: 1_000,
          maxExpandedBytes: 2_000,
          maxFileCount: 10,
          maxFileBytes: 1_000,
          enabledExtensions: [".html"]
        }
      }),
      json({ artifacts: [artifact()] })
    ]);
    vi.stubGlobal("XMLHttpRequest", acceptedUploadRequest());

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "New artifact" }));
    await screen.findByRole("heading", { name: "New artifact" });
    await interaction.upload(screen.getByLabelText("Artifact file"), new File(["zip"], "report.zip", { type: "application/zip" }));
    await interaction.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByRole("heading", { name: "Artifacts" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Report" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/artifacts");
  });

  it("refreshes processing state without moving the action layout", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([
      json({ user }),
      json({ artifact: artifact({ processingState: "processing" }) }),
      json({
        artifact: artifact({
          uploadSessionId: null,
          processingState: "ready",
          readyVersion: { id: "version-1", state: "ready" },
          allowedActions: ["rename", "preview", "publish", "copy_share_link"]
        })
      })
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Refresh status" }));

    expect(await screen.findByText("Not active")).toBeInTheDocument();
    expect(screen.getByText("Status refreshed.").closest('[data-slot="alert"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share with link" })).toBeEnabled();
  });

  it("retries a recoverable failure against its current Upload session", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    const fetchMock = stubFetch([
      json({ user }),
      json({
        artifact: artifact({
          processingState: "failed",
          failure: { code: "object_storage_unavailable", message: "Storage is unavailable.", recoverable: true },
          allowedActions: ["rename", "retry", "copy_share_link"]
        })
      }),
      json({
        artifactId: "artifact-1",
        uploadSessionId: "upload-1",
        processingState: "accepted",
        shareLink: artifact().shareLink
      }, 202),
      json({ artifact: artifact({ processingState: "accepted" }) })
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Retry queued.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/upload-sessions/upload-1:retry",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeEnabled();
  });

  it("explains deterministic validation failure and accepts a replacement ZIP", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([
      json({ user }),
      json({
        artifact: artifact({
          processingState: "failed",
          failure: { code: "missing_entry_file", message: "index.html is missing.", recoverable: false },
          allowedActions: ["rename", "replace_file", "copy_share_link"]
        })
      }),
      json({ policy: uploadPolicy() }),
      json({
        artifactId: "artifact-1",
        uploadSessionId: "upload-2",
        processingState: "accepted",
        shareLink: artifact().shareLink
      }, 202),
      json({ artifact: artifact({ uploadSessionId: "upload-2", processingState: "accepted" }) })
    ]);
    preflightArtifactZip.mockRejectedValueOnce(new Error("worker failed"));

    render(<App />);
    expect(await screen.findByText("Replace the file with a corrected ZIP to continue.")).toBeInTheDocument();
    expect(screen.getByLabelText("Replacement ZIP")).toHaveAttribute("data-slot", "input");
    await interaction.upload(
      screen.getByLabelText("Replacement ZIP"),
      new File(["zip"], "corrected.zip", { type: "application/zip" })
    );

    expect(await screen.findByText("Replacement uploaded and queued.")).toBeInTheDocument();
    expect(screen.getByText("ZIP preflight is unavailable. Server validation still applies.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeEnabled();
  });

  it("shows structured validation details before the legacy failure", async () => {
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([
      json({ user }),
      json({
        artifact: artifact({
          processingState: "failed",
          failure: { code: "single_file_size_exceeded", message: "Legacy failure summary.", recoverable: false },
          validationReport: {
            primaryIssue: {
              code: "single_file_too_large",
              message: "A file exceeds the allowed size.",
              action: "Reduce or split the file, then upload a new ZIP.",
              details: {
                path: "data/report.json",
                actualBytes: "18446744073709551615",
                limitBytes: 52_428_800
              }
            },
            issues: [],
            warnings: []
          },
          allowedActions: ["replace_file"]
        })
      })
    ]);

    render(<App />);

    expect(await screen.findByText("A file exceeds the allowed size.")).toBeInTheDocument();
    expect(screen.getByText("data/report.json")).toBeInTheDocument();
    expect(screen.getByText("18446744073709551615 B")).toBeInTheDocument();
    expect(screen.getByText("50 MiB")).toBeInTheDocument();
    expect(screen.getByText("Reduce or split the file, then upload a new ZIP.")).toBeInTheDocument();
    expect(screen.queryByText("Legacy failure summary.")).not.toBeInTheDocument();
  });

  it("shows ready normalization warnings without removing ready actions", async () => {
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([
      json({ user }),
      json({
        artifact: artifact({
          processingState: "ready",
          readyVersion: { id: "version-1", state: "ready" },
          validationReport: {
            primaryIssue: null,
            issues: [],
            warnings: [
              {
                code: "ignored_system_metadata",
                message: "System metadata files were ignored.",
                action: null,
                details: { ignoredCount: 2, paths: ["__MACOSX/._report.html", ".DS_Store"] }
              },
              {
                code: "entry_file_inferred",
                message: "The only root HTML file was selected as the entry file.",
                action: null,
                details: { entryFile: "report.html" }
              }
            ]
          },
          allowedActions: ["preview", "publish", "copy_share_link"]
        })
      })
    ]);

    render(<App />);

    const metadataWarning = await screen.findByText("System metadata files were ignored.");
    expect(metadataWarning.closest('[data-slot="alert"]')).not.toHaveAttribute("data-variant", "destructive");
    expect(screen.getByText("2 files ignored")).toBeInTheDocument();
    expect(screen.getByText("__MACOSX/._report.html")).toBeInTheDocument();
    expect(screen.getByText("The only root HTML file was selected as the entry file.")).toBeInTheDocument();
    expect(screen.getByText("report.html")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Share with link" })).toBeEnabled();
  });

  it("blocks replacement before upload when ZIP preflight finds a primary issue", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    const fetchMock = stubFetch([
      json({ user }),
      json({ artifact: artifact({ processingState: "failed", allowedActions: ["replace_file"] }) }),
      json({ policy: uploadPolicy() })
    ]);
    preflightArtifactZip.mockResolvedValue({
      primaryIssue: {
        code: "missing_entry_file",
        message: "The ZIP has no root HTML entry file.",
        action: "Add one HTML file at the ZIP root.",
        details: { candidates: ["nested/report.html"] }
      },
      issues: [],
      warnings: []
    });

    render(<App />);
    await interaction.upload(await screen.findByLabelText("Replacement ZIP"), new File(["zip"], "replacement.zip", { type: "application/zip" }));

    expect(await screen.findByText("The ZIP has no root HTML entry file.")).toBeInTheDocument();
    expect(screen.getByText("Add one HTML file at the ZIP root.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("opens the authenticated ready-Version Preview", async () => {
    const interaction = userEvent.setup();
    const replace = vi.fn();
    const previewWindow = { opener: window, location: { replace } } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(previewWindow);
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([
      json({ user }),
      json({
        artifact: artifact({
          uploadSessionId: null,
          processingState: "ready",
          readyVersion: { id: "version/1", state: "ready" },
          allowedActions: ["rename", "preview", "publish", "copy_share_link"]
        })
      })
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Preview" }));

    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(replace).toHaveBeenCalledWith("/artifacts/artifact-1/preview?versionId=version%2F1");
    expect(await screen.findByText("Preview opened in a new tab.")).toBeInTheDocument();
    expect(previewWindow.opener).toBeNull();
  });

  it("renders an authenticated ready-Version in the trusted Preview player", async () => {
    window.history.replaceState(null, "", "/artifacts/artifact-1/preview?versionId=version%2F1");
    stubFetch([json({ user })]);

    render(<App />);

    expect(await screen.findByTitle("Artifact content")).toHaveAttribute("src", "/api/versions/version%2F1/content/");
    expect(screen.getByRole("button", { name: "Enter full screen" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Artifacts" })).not.toBeInTheDocument();
  });

  it("shows publication pending and failure states without losing the allowed action", async () => {
    const interaction = userEvent.setup();
    let resolvePublication!: (response: Response) => void;
    const publicationResponse = new Promise<Response>((resolve) => {
      resolvePublication = resolve;
    });
    const responses: Array<Response | Promise<Response>> = [
      json({ user }),
      json({
        artifact: artifact({
          uploadSessionId: null,
          processingState: "ready",
          readyVersion: { id: "version-1", state: "ready" },
          allowedActions: ["rename", "preview", "publish", "copy_share_link"]
        })
      }),
      publicationResponse
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const response = responses.shift();
        if (!response) throw new Error("Unexpected fetch call.");
        return response;
      })
    );
    window.history.replaceState(null, "", "/artifacts/artifact-1");

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Share with link" }));
    await interaction.click(screen.getByRole("button", { name: "Share with link" }));
    expect(screen.getByRole("button", { name: "LoadingShare with link" })).toBeDisabled();
    resolvePublication(json({ error: { code: "version_not_ready", message: "Version is not ready." } }, 409));

    expect(await screen.findByText("Version is not ready.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share with link" })).toBeEnabled();
  });

  it("copies the stable Share link and reports clipboard failure", async () => {
    const interaction = userEvent.setup();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([json({ user }), json({ artifact: artifact({ publication: publication(), publicationStatus: "published", allowedActions: ["copy_share_link"] }) })]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Copy Share link" }));
    expect(await screen.findByText("Share link copied.")).toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Copy Share link" }));

    expect(await screen.findByText("The Share link could not be copied.")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("https://view.example.test/a/share-1/");
  });

  it("routes an expired action session to Log in", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([
      json({ user }),
      json({
        artifact: artifact({
          uploadSessionId: null,
          processingState: "ready",
          readyVersion: { id: "version-1", state: "ready" },
          allowedActions: ["rename", "preview", "publish", "copy_share_link"]
        })
      }),
      json({ error: { code: "unauthenticated", message: "Sign in required." } }, 401)
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Share with link" }));
    await interaction.click(screen.getByRole("button", { name: "Share with link" }));

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("shows an ownership-safe not-found error without Artifact data", async () => {
    window.history.replaceState(null, "", "/artifacts/not-owned");
    stubFetch([
      json({ user }),
      json({ error: { code: "artifact_not_found", message: "Artifact not found." } }, 404)
    ]);

    render(<App />);

    expect(await screen.findByText("Artifact not found.")).toBeInTheDocument();
    expect(screen.queryByText("Report")).not.toBeInTheDocument();
  });

  it("publishes a never-published Artifact permanently without exposing a link first", async () => {
    const interaction = userEvent.setup();
    const ready = artifact({
      processingState: "ready",
      shareLink: null,
      readyVersion: { id: "version-1", state: "ready" },
      allowedActions: ["publish"]
    });
    const published = artifact({
      ...ready,
      shareLink: { url: "https://view.example.test/a/new-link/", state: "active" },
      publicationStatus: "published",
      publication: publication(),
      allowedActions: ["publish", "manage_publication", "copy_share_link", "unpublish"]
    });
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    const fetchMock = stubFetch([json({ user }), json({ artifact: ready }), json({ publication: published.publication, shareLink: published.shareLink }, 201), json({ artifact: published })]);

    render(<App />);
    expect(await screen.findByText("Created when published")).toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Share with link" }));
    expect(await screen.findByRole("heading", { name: "Share with link" })).toBeInTheDocument();
    expect(screen.getByLabelText("Share link")).toHaveValue("Available after publishing");
    expect(screen.getByRole("button", { name: "Copy Share link" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Access period" })).toHaveAttribute("data-slot", "select-trigger");
    await interaction.click(screen.getByRole("button", { name: "Share with link" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/artifact-1/publications", expect.objectContaining({ method: "POST", body: JSON.stringify({ versionId: "version-1", expiration: { kind: "permanent" }, link: { mode: "reuse" } }) })));
    expect(await screen.findByRole("heading", { name: "Link sharing active" })).toBeInTheDocument();
    expect(screen.getByLabelText("Share link")).toHaveValue("https://view.example.test/a/new-link/");
    expect(screen.getByRole("button", { name: "Copy Share link" })).toBeEnabled();
  });

  it("uses the Base UI custom date picker and rejects an incomplete expiration", async () => {
    const interaction = userEvent.setup();
    const ready = artifact({
      processingState: "ready",
      shareLink: null,
      readyVersion: { id: "version-1", state: "ready" },
      allowedActions: ["publish"]
    });
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    const fetchMock = stubFetch([json({ user }), json({ artifact: ready })]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Share with link" }));
    await interaction.click(screen.getByRole("combobox", { name: "Access period" }));
    await interaction.click(await screen.findByRole("option", { name: "Custom date and time" }));

    expect(screen.getByRole("button", { name: "Choose date" })).toHaveAttribute("data-slot", "popover-trigger");
    expect(screen.getByLabelText("Expiration time")).toHaveAttribute("type", "time");
    await interaction.click(screen.getByRole("button", { name: "Choose date" }));
    expect(document.querySelector('[data-slot="calendar"]')).toBeInTheDocument();
    await interaction.keyboard("{Escape}");
    await interaction.click(screen.getByRole("button", { name: "Share with link" }));

    expect(await screen.findByText("Choose a future expiration date and time. Use Unpublish to end access now.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires explicit irreversible confirmation before replacing a Share link", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    const fetchMock = stubFetch([json({ user }), json({ artifact: artifact({ processingState: "ready", readyVersion: { id: "version-1", state: "ready" }, publicationStatus: "expired", publication: publication(), allowedActions: ["publish"] }) })]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Share with link" }));
    await interaction.click(screen.getByRole("checkbox", { name: "Generate a new Share link" }));
    await interaction.click(screen.getByRole("button", { name: "Share with link" }));

    expect(await screen.findByText("Confirm that the previous link will permanently stop working.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("manages only an active Publication and can end it early", async () => {
    const interaction = userEvent.setup();
    const published = artifact({ processingState: "ready", readyVersion: { id: "version-1", state: "ready" }, publicationStatus: "published", publication: publication(), allowedActions: ["manage_publication", "copy_share_link", "unpublish"] });
    const unpublished = artifact({ ...published, publicationStatus: "unpublished", allowedActions: ["publish"] });
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    const fetchMock = stubFetch([json({ user }), json({ artifact: published }), new Response(null, { status: 204 }), json({ artifact: unpublished })]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Manage link" }));
    expect(screen.getByRole("button", { name: "Copy Share link" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save link settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Done$/ })).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Unpublish" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/artifact-1/publications/publication-1", expect.objectContaining({ method: "DELETE" })));
    expect(await screen.findByText("Stopped")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Copy Share link" })).not.toBeInTheDocument());
  });
});

function publication() {
  return { id: "publication-1", versionId: "version-1", publishedAt: "2026-07-10T00:00:00.000Z", expirationKind: "permanent", durationSeconds: null, expiresAt: null, endedAt: null, endReason: null };
}

function artifact(overrides: Record<string, unknown> = {}) {
  const value = {
    id: "artifact-1",
    name: "Report",
    updatedAt: "2026-07-10T00:00:00.000Z",
    uploadSessionId: "upload-1",
    processingState: "accepted",
    shareLink: { url: "https://view.example.test/a/share-1/", state: "active", expiresAt: null },
    readyVersion: null,
    publication: null,
    publicationStatus: "not_published",
    failure: null,
    validationReport: null,
    publicSharingRestriction: null,
    allowedActions: ["rename", "copy_share_link"],
    ...overrides
  };
  if (!("publicationStatus" in overrides) && value.publication) value.publicationStatus = "published";
  return value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function uploadPolicy() {
  return {
    revision: "policy-1",
    maxArchiveBytes: 1_000,
    maxExpandedBytes: 2_000,
    maxFileCount: 10,
    maxFileBytes: 1_000,
    enabledExtensions: [".html"]
  };
}

function stubFetch(responses: Response[]) {
  const fetchMock = vi.fn(async () => {
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected fetch call.");
    }
    return response;
  });
  vi.stubGlobal(
    "fetch",
    fetchMock
  );
  return fetchMock;
}

function acceptedUploadRequest(onSend?: (body: Document | XMLHttpRequestBodyInit | null) => void) {
  return class {
    status = 0;
    responseText = "";
    withCredentials = false;
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;

    open() {}
    setRequestHeader() {}
    send(body: Document | XMLHttpRequestBodyInit | null) {
      onSend?.(body);
      this.status = 202;
      this.responseText = JSON.stringify({
        artifactId: "artifact-1",
        uploadSessionId: "upload-1",
        processingState: "accepted",
        shareLink: { url: "https://view.example.test/a/share-1/", state: "active" }
      });
      this.onload?.();
    }
  };
}
