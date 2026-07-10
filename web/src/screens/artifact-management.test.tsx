import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const user = { id: "user-1", name: "Ada", email: "ada@example.com" };

describe("Artifact management", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    expect(screen.getByText("Ready to publish")).toBeInTheDocument();
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
    await interaction.clear(name);
    await interaction.type(name, "Quarterly report");
    await interaction.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("heading", { name: "Quarterly report" })).toBeInTheDocument();
    expect(screen.getByText("artifact-1")).toBeInTheDocument();
  });

  it("validates a create form before uploading", async () => {
    const interaction = userEvent.setup();
    window.history.replaceState(null, "", "/artifacts/new");
    stubFetch([
      json({ user }),
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
    await screen.findByRole("heading", { name: "New artifact" });
    await interaction.type(screen.getByLabelText("Artifact name"), "Report");
    await interaction.upload(
      screen.getByLabelText("ZIP file"),
      new File(["oversized"], "report.zip", { type: "application/zip" })
    );
    await interaction.click(screen.getByRole("button", { name: "Upload artifact" }));

    expect(await screen.findByText("This ZIP exceeds the 4 B upload limit.")).toBeInTheDocument();
  });

  it("keeps accepted and published states distinct", async () => {
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([
      json({ user }),
      json({
        artifact: artifact({
          processingState: "ready",
          readyVersion: { id: "version-1", state: "ready" },
          publication: { id: "publication-1", versionId: "version-1", publishedAt: "2026-07-10T00:00:00.000Z" },
          allowedActions: ["rename", "preview", "unpublish", "copy_share_link"]
        })
      })
    ]);

    render(<App />);

    expect(await screen.findByText("Published")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeEnabled();
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
    window.history.replaceState(null, "", "/artifacts/new");
    stubFetch([
      json({ user }),
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
    await screen.findByRole("heading", { name: "New artifact" });
    await interaction.type(screen.getByLabelText("Artifact name"), "Report");
    await interaction.upload(screen.getByLabelText("ZIP file"), new File(["zip"], "report.zip", { type: "application/zip" }));
    await interaction.click(screen.getByRole("button", { name: "Upload artifact" }));

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

    expect(await screen.findByText("Ready to publish")).toBeInTheDocument();
    expect(screen.getByText("Status refreshed.")).toBeInTheDocument();
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
      json({
        artifactId: "artifact-1",
        uploadSessionId: "upload-2",
        processingState: "accepted",
        shareLink: artifact().shareLink
      }, 202),
      json({ artifact: artifact({ uploadSessionId: "upload-2", processingState: "accepted" }) })
    ]);

    render(<App />);
    expect(await screen.findByText("Replace the file with a corrected ZIP to continue.")).toBeInTheDocument();
    await interaction.upload(
      screen.getByLabelText("Replacement ZIP"),
      new File(["zip"], "corrected.zip", { type: "application/zip" })
    );

    expect(await screen.findByText("Replacement uploaded and queued.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeEnabled();
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

  it("publishes, unpublishes, and republishes without changing the Share link", async () => {
    const interaction = userEvent.setup();
    const ready = artifact({
      uploadSessionId: null,
      processingState: "ready",
      readyVersion: { id: "version-1", state: "ready" },
      allowedActions: ["rename", "preview", "publish", "copy_share_link"]
    });
    const published = artifact({
      ...ready,
      publication: { id: "publication-1", versionId: "version-1", publishedAt: "2026-07-10T00:00:00.000Z" },
      allowedActions: ["rename", "preview", "unpublish", "copy_share_link"]
    });
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([
      json({ user }),
      json({ artifact: ready }),
      json({ publication: published.publication }, 201),
      json({ artifact: published }),
      new Response(null, { status: 204 }),
      json({ artifact: ready }),
      json({ publication: published.publication }, 201),
      json({ artifact: published })
    ]);

    render(<App />);
    await interaction.click(await screen.findByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Artifact published.")).toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Unpublish" }));
    expect(await screen.findByText("Artifact unpublished. The Share link is unchanged.")).toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("Artifact published.")).toBeInTheDocument();
    expect(screen.getByText("https://view.example.test/a/share-1/")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Publishing..." })).toBeDisabled();
    resolvePublication(json({ error: { code: "version_not_ready", message: "Version is not ready." } }, 409));

    expect(await screen.findByText("Version is not ready.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("copies the stable Share link and reports clipboard failure", async () => {
    const interaction = userEvent.setup();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    window.history.replaceState(null, "", "/artifacts/artifact-1");
    stubFetch([json({ user }), json({ artifact: artifact() })]);

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
});

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    name: "Report",
    uploadSessionId: "upload-1",
    processingState: "accepted",
    shareLink: { url: "https://view.example.test/a/share-1/", state: "active" },
    readyVersion: null,
    publication: null,
    failure: null,
    allowedActions: ["rename", "copy_share_link"],
    ...overrides
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
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

function acceptedUploadRequest() {
  return class {
    status = 0;
    responseText = "";
    withCredentials = false;
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;

    open() {}
    setRequestHeader() {}
    send() {
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
