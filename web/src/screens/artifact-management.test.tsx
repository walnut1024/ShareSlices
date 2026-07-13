import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const preflightArtifactZip = vi.hoisted(() => vi.fn());
vi.mock("../artifacts/archive-preflight-client", () => ({ preflightArtifactZip }));

const user = { id: "user-1", name: "Ada", email: "ada@example.com" };

describe("Artifact management", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    preflightArtifactZip.mockReset();
    preflightArtifactZip.mockResolvedValue({ primaryIssue: null, issues: [], warnings: [] });
  });

  it("routes an authenticated user to the Artifact list", async () => {
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([
      json({ user }),
      json({ artifacts: [artifact({ processingState: "processing", allowedActions: ["rename", "copy_share_link"] })] })
    ]);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Artifacts" })).toBeInTheDocument();
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
    expect(document.querySelector('[data-slot="avatar"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="toggle-group"]')).toBeInTheDocument();
    expect(artifactCard).toHaveClass("shadow-[0_1px_2px_rgba(9,9,11,0.05)]");
    expect(artifactCard?.querySelector('[data-slot="aspect-ratio"]')).toHaveStyle({ "--ratio": "1.6" });
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
    expect(within(card).getByRole("link", { name: "Preview Report" })).toHaveAttribute("href", "/api/versions/version%2F1/content/");
    expect(within(card).getByRole("link", { name: "Preview Report" })).toHaveAttribute("target", "_blank");
    expect(within(card).queryByRole("button", { name: "Start presentation for Report" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Start presentation for Report" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share Report" })).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "More actions for Report" }));
    expect(await screen.findByRole("menuitem", { name: "Info" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument();
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
    expect(screen.getByText("Not published")).toHaveAttribute("data-slot", "badge");
    expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
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
    expect(screen.getByText("Drop a ZIP file here").closest("label")).toHaveAttribute("data-slot", "label");
    expect(screen.queryByLabelText("Artifact name")).not.toBeInTheDocument();
    await interaction.upload(
      screen.getByLabelText("ZIP file"),
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
    await interaction.upload(screen.getByLabelText("ZIP file"), new File(["zip"], "report.zip", { type: "application/zip" }));
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
    await interaction.upload(screen.getByLabelText("ZIP file"), new File(["zip"], "report.zip", { type: "application/zip" }));
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
      json({ artifact: artifact() })
    ]);
    vi.stubGlobal("XMLHttpRequest", acceptedUploadRequest());
    preflightArtifactZip.mockRejectedValue(new Error("worker failed"));

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "New artifact" }));
    await interaction.upload(screen.getByLabelText("ZIP file"), new File(["zip"], "report.zip", { type: "application/zip" }));
    await interaction.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByRole("heading", { name: "Report" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/artifacts/artifact-1");
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
    const file = screen.getByLabelText("ZIP file");

    await interaction.upload(file, new File(["zip"], "quarterly-report.zip", { type: "application/zip" }));
    expect(screen.queryByLabelText("Artifact name")).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(send).toHaveBeenCalled());
    const body = send.mock.calls[0]?.[0] as FormData;
    expect(body.get("name")).toBe("quarterly-report");
  });

  it("accepts a ZIP dropped onto the file target", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts");
    stubFetch([json({ user }), json({ artifacts: [] }), json({ policy: uploadPolicy() })]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "New artifact" }));
    const target = screen.getByText("Drop a ZIP file here").closest("label");
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
    await interaction.upload(screen.getByLabelText("ZIP file"), new File(["zip"], ".zip", { type: "application/zip" }));
    await interaction.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Rename the ZIP file before uploading.")).toBeInTheDocument();
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

    expect(await screen.findByText("Published")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage publication" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
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

  it("navigates an accepted upload to its stable Artifact detail", async () => {
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
      json({ artifact: artifact() })
    ]);
    vi.stubGlobal("XMLHttpRequest", acceptedUploadRequest());

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "New artifact" }));
    await screen.findByRole("heading", { name: "New artifact" });
    await interaction.upload(screen.getByLabelText("ZIP file"), new File(["zip"], "report.zip", { type: "application/zip" }));
    await interaction.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByRole("heading", { name: "Report" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/artifacts/artifact-1");
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

    expect(await screen.findByText("Not published")).toBeInTheDocument();
    expect(screen.getByText("Status refreshed.").closest('[data-slot="alert"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
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
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
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
    const previewWindow = { opener: window } as unknown as Window;
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

    expect(open).toHaveBeenCalledWith("/api/versions/version%2F1/content/", "_blank");
    expect(await screen.findByText("Preview opened in a new tab.")).toBeInTheDocument();
    expect(previewWindow.opener).toBeNull();
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
    await interaction.click(await screen.findByRole("button", { name: "Publish" }));
    await interaction.click(screen.getByRole("button", { name: "Publish" }));
    expect(screen.getByRole("button", { name: "LoadingPublish" })).toBeDisabled();
    resolvePublication(json({ error: { code: "version_not_ready", message: "Version is not ready." } }, 409));

    expect(await screen.findByText("Version is not ready.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
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
    await interaction.click(await screen.findByRole("button", { name: "Publish" }));
    await interaction.click(screen.getByRole("button", { name: "Publish" }));

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
    await interaction.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("heading", { name: "Publish artifact" })).toBeInTheDocument();
    expect(screen.getByLabelText("Share link")).toHaveValue("Available after publishing");
    expect(screen.getByRole("button", { name: "Copy Share link" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Access period" })).toHaveAttribute("data-slot", "select-trigger");
    await interaction.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/artifact-1/publications", expect.objectContaining({ method: "POST", body: JSON.stringify({ versionId: "version-1", expiration: { kind: "permanent" }, link: { mode: "reuse" } }) })));
    expect(await screen.findByRole("heading", { name: "Artifact published" })).toBeInTheDocument();
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
    await interaction.click(await screen.findByRole("button", { name: "Publish" }));
    await interaction.click(screen.getByRole("combobox", { name: "Access period" }));
    await interaction.click(await screen.findByRole("option", { name: "Custom date and time" }));

    expect(screen.getByRole("button", { name: "Choose date" })).toHaveAttribute("data-slot", "popover-trigger");
    expect(screen.getByLabelText("Expiration time")).toHaveAttribute("type", "time");
    await interaction.click(screen.getByRole("button", { name: "Choose date" }));
    expect(document.querySelector('[data-slot="calendar"]')).toBeInTheDocument();
    await interaction.keyboard("{Escape}");
    await interaction.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("Choose a future expiration date and time. Use Unpublish to end access now.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires explicit irreversible confirmation before replacing a Share link", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    const fetchMock = stubFetch([json({ user }), json({ artifact: artifact({ processingState: "ready", readyVersion: { id: "version-1", state: "ready" }, publicationStatus: "expired", publication: publication(), allowedActions: ["publish"] }) })]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Publish" }));
    await interaction.click(screen.getByRole("checkbox", { name: "Generate a new Share link" }));
    await interaction.click(screen.getByRole("button", { name: "Publish" }));

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
    await interaction.click(await screen.findByRole("button", { name: "Manage publication" }));
    expect(screen.getByRole("button", { name: "Copy Share link" })).toBeEnabled();
    await interaction.click(screen.getByRole("button", { name: "Unpublish" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/artifact-1/publications/publication-1", expect.objectContaining({ method: "DELETE" })));
    expect(await screen.findByText("Unpublished")).toBeInTheDocument();
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
