import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createArtifact,
  getUploadPolicy,
  listArtifacts,
  publishArtifact,
  replaceArtifactFile,
  retryUploadSession,
  unpublishArtifact,
  updateArtifactName
} from "./artifacts";

describe("Artifact API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the optional upload policy with the management session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            policy: {
              revision: "policy-1",
              maxArchiveBytes: 52_428_800,
              maxExpandedBytes: 209_715_200,
              maxFileCount: 1_000,
              maxFileBytes: 52_428_800,
              enabledExtensions: [".html", ".css", ".js"]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    await expect(getUploadPolicy()).resolves.toMatchObject({ revision: "policy-1", maxFileCount: 1_000 });
    expect(fetch).toHaveBeenCalledWith(
      "/api/artifact-upload-policies/current",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("lists owned Artifacts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ artifacts: [artifact] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );

    await expect(listArtifacts()).resolves.toEqual([artifact]);
  });

  it("patches the mutable name without changing identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ artifact: { ...artifact, name: "Quarterly report" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );

    await expect(updateArtifactName("artifact-1", "Quarterly report")).resolves.toMatchObject({
      id: "artifact-1",
      name: "Quarterly report"
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/artifacts/artifact-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Quarterly report" }) })
    );
  });

  it("uploads multipart data with an idempotency key and reports progress", async () => {
    const progress: number[] = [];
    const send = vi.fn();
    let request: FakeXMLHttpRequest | null = null;

    class FakeXMLHttpRequest {
      method = "";
      url = "";
      requestHeaders = new Map<string, string>();
      responseText = "";
      status = 0;
      withCredentials = false;
      upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      constructor() {
        request = this;
      }

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }

      setRequestHeader(name: string, value: string) {
        this.requestHeaders.set(name, value);
      }

      send(body: FormData) {
        send(body);
        this.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 } as ProgressEvent);
        this.status = 202;
        this.responseText = JSON.stringify(accepted);
        this.onload?.();
      }
    }

    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const file = new File(["zip"], "artifact.zip", { type: "application/zip" });

    await expect(
      createArtifact({ name: "Report", file, idempotencyKey: "idem-1", onProgress: (value) => progress.push(value) })
    ).resolves.toEqual(accepted);

    const created = request as unknown as FakeXMLHttpRequest;
    expect(send).toHaveBeenCalledOnce();
    expect(progress).toEqual([25]);
    expect(created.method).toBe("POST");
    expect(created.url).toBe("/api/artifacts");
    expect(created.withCredentials).toBe(true);
    expect(created.requestHeaders.get("Idempotency-Key")).toBe("idem-1");
  });

  it("preserves structured upload errors returned by XMLHttpRequest", async () => {
    class RejectedXMLHttpRequest {
      status = 0;
      responseText = "";
      withCredentials = false;
      upload = { onprogress: null };
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
    }
    vi.stubGlobal("XMLHttpRequest", RejectedXMLHttpRequest);

    await expect(createArtifact({
      name: "Report",
      file: new File(["zip"], "artifact.zip", { type: "application/zip" }),
      idempotencyKey: "idem-1"
    })).rejects.toMatchObject({
      code: "archive_too_large",
      status: 413,
      message: "ZIP exceeds the upload limit.",
      action: "Reduce the ZIP below the upload limit and try again.",
      details: { limitBytes: 52_428_800 }
    });
  });

  it("sends recovery operations to the current Upload session and stable Artifact", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(accepted, 202))
      .mockResolvedValueOnce(json(accepted, 202));
    vi.stubGlobal("fetch", fetchMock);

    await retryUploadSession("upload/1", "retry-key");
    const replacement = new File(["zip"], "replacement.zip", { type: "application/zip" });
    await replaceArtifactFile("artifact/1", replacement, "replace-key");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/upload-sessions/upload%2F1:retry",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        headers: { "Idempotency-Key": "retry-key" }
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/artifacts/artifact%2F1/upload-sessions",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        headers: { "Idempotency-Key": "replace-key" },
        body: expect.any(FormData)
      })
    );
  });

  it("publishes a ready Version and unpublishes the current Publication", async () => {
    const publication = { id: "publication-1", versionId: "version-1", publishedAt: "2026-07-10T00:00:00.000Z" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ publication }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(publishArtifact("artifact-1", "version-1", "publish-key")).resolves.toEqual(publication);
    await expect(unpublishArtifact("artifact-1", "publication-1")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/artifacts/artifact-1/publications",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "publish-key" },
        body: JSON.stringify({ versionId: "version-1" })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/artifacts/artifact-1/publications/publication-1",
      expect.objectContaining({ credentials: "include", method: "DELETE" })
    );
  });
});

const artifact = {
  id: "artifact-1",
  name: "Report",
  uploadSessionId: "upload-1",
  processingState: "accepted" as const,
  shareLink: { url: "https://view.example.test/a/share-1/", state: "active" as const },
  readyVersion: null,
  publication: null,
  failure: null,
  allowedActions: ["rename", "copy_share_link"] as const
};

const accepted = {
  artifactId: "artifact-1",
  uploadSessionId: "upload-1",
  processingState: "accepted" as const,
  shareLink: { url: "https://view.example.test/a/share-1/", state: "active" as const }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
