import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/http/app.js";
import { apiLogger } from "../src/logging/index.js";
import { InMemoryObjectStorage } from "../src/storage/index.js";

async function* bytes(value: string): AsyncIterable<Uint8Array> {
  yield Buffer.from(value);
}

async function dependencies(session: { user: { id: string } } | null = { user: { id: "owner-1" } }) {
  const storage = new InMemoryObjectStorage();
  await storage.writeStagingObject({
    key: "committed/version-1/index.html",
    body: bytes('<script src="assets/app.js"></script>'),
    contentType: "text/html; charset=utf-8"
  });
  await storage.writeStagingObject({
    key: "versions/version-1/thumbnail.webp",
    body: bytes("thumbnail"),
    contentType: "image/webp"
  });
  await storage.writeStagingObject({
    key: "committed/version-1/腾讯文档盘点分析报告.html",
    body: bytes('<script src="assets/app.js"></script>'),
    contentType: "text/html; charset=utf-8"
  });
  await storage.writeStagingObject({
    key: "committed/version-1/assets/app.js",
    body: bytes("window.ready = true"),
    contentType: "text/javascript"
  });
  const asset = (path: string) => ({
    versionId: "version-1",
    path,
    objectKey: `committed/version-1/${path}`,
    sizeBytes: 1,
    contentType: path.endsWith(".html") ? "text/html; charset=utf-8" : "text/javascript",
    sha256: "a".repeat(64)
  });
  return {
    authApi: { getSession: vi.fn().mockResolvedValue(session) },
    service: {
      preview: vi.fn(async (_owner: string, _version: string, path: string) =>
        asset(path || "腾讯文档盘点分析报告.html")
      ),
      exportVersion: vi.fn().mockResolvedValue({
        artifactId: "artifact-1",
        artifactName: "Board deck",
        assets: [asset("index.html"), asset("assets/app.js")]
      }),
      publish: vi.fn().mockResolvedValue({
        publication: {
          id: "publication-1",
          versionId: "version-1",
          publishedAt: new Date("2026-07-10T00:00:00Z"),
          expirationKind: "permanent",
          durationSeconds: null,
          expiresAt: null,
          endedAt: null,
          endReason: null
        },
        shareLink: {
          url: "https://viewer.example/a/stable-slug/",
          state: "active"
        }
      }),
      updateExpiration: vi.fn(),
      unpublish: vi.fn().mockResolvedValue(undefined),
      resolveViewer: vi.fn(async (_slug: string, path: string) =>
        asset(path || "腾讯文档盘点分析报告.html")
      )
    },
    storage,
    thumbnailRepository: {
      findOwned: vi.fn().mockResolvedValue({ objectKey: "versions/version-1/thumbnail.webp", contentType: "image/webp" }),
      consumeGrant: vi.fn().mockResolvedValue({ versionId: "version-1", token: "capture-session", expiresAt: new Date(Date.now() + 30_000) }),
      resolveSession: vi.fn().mockResolvedValue(true),
      findVersionAsset: vi.fn(async (_versionId: string, path: string) => ({
        objectKey: path ? `committed/version-1/${path}` : "committed/version-1/index.html",
        contentType: path.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8"
      }))
    },
    managementOrigin: "http://127.0.0.1:5173"
  };
}

describe("Publication, Preview, and Viewer routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiLogger, "emit").mockImplementation(() => undefined);
  });

  it("requires the current management session for every Preview request", async () => {
    const deps = await dependencies(null);
    const app = buildApp({ publicationViewer: deps } as never);

    const response = await app.request("/api/versions/version-1/content/");

    expect(response.status).toBe(401);
    expect(deps.service.preview).not.toHaveBeenCalled();
  });

  it("keeps Preview cookie-only when a valid Bearer Session is present", async () => {
    const deps = await dependencies();
    const app = buildApp({ publicationViewer: deps } as never);

    const response = await app.request("/api/versions/version-1/content/", {
      headers: {
        authorization: "Bearer cli-session",
        "ShareSlices-CLI-Version": "0.1.0",
        "ShareSlices-CLI-OS": "macos"
      }
    });

    expect(response.status).toBe(401);
    expect(deps.authApi.getSession).not.toHaveBeenCalled();
    expect(deps.service.preview).not.toHaveBeenCalled();
  });

  it("streams Preview entry and relative assets with no-store", async () => {
    const deps = await dependencies();
    const app = buildApp({ publicationViewer: deps } as never);

    const entry = await app.request("/api/versions/version-1/content/");
    const asset = await app.request("/api/versions/version-1/content/assets/app.js");
    const viewerAsset = await app.request("/a/stable-slug/assets/app.js");
    const rootAbsolute = await app.request("/assets/app.js");

    expect(entry.status).toBe(200);
    expect(entry.headers.get("cache-control")).toBe("no-store");
    expect(entry.headers.get("content-type")).toContain("text/html");
    expect(await entry.text()).toContain('src="assets/app.js"');
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("no-store");
    expect(await asset.text()).toBe("window.ready = true");
    expect(viewerAsset.status).toBe(200);
    expect(viewerAsset.headers.get("cache-control")).toBe("no-store");
    expect(await viewerAsset.text()).toBe("window.ready = true");
    expect(rootAbsolute.status).toBe(404);
    expect(deps.service.preview).toHaveBeenCalledWith("owner-1", "version-1", "");
    await app.request("/a/stable-slug/");
    expect(deps.service.resolveViewer).toHaveBeenCalledWith("stable-slug", "");
  });

  it("serves a trusted Viewer player while content mode preserves the Artifact entry base", async () => {
    const deps = await dependencies();
    const readCommittedObject = vi.spyOn(deps.storage, "readCommittedObject");
    const app = buildApp({ publicationViewer: deps } as never);

    const player = await app.request("/a/stable-slug/");
    const playerHtml = await player.text();
    expect(readCommittedObject).not.toHaveBeenCalled();
    const content = await app.request("/a/stable-slug/?contentMode=true");
    const contentHtml = await content.text();
    const selfNavigation = await app.request("/a/stable-slug/", {
      headers: { "Sec-Fetch-Dest": "iframe" }
    });

    expect(player.status).toBe(200);
    expect(player.headers.get("cache-control")).toBe("no-store");
    expect(player.headers.get("content-type")).toContain("text/html");
    expect(playerHtml).toContain('aria-label="Enter full screen"');
    expect(playerHtml).toContain('src="/a/stable-slug/?contentMode=true"');
    expect(playerHtml).not.toContain('<script src="assets/app.js"></script>');
    expect(content.status).toBe(200);
    expect(content.headers.get("cache-control")).toBe("no-store");
    expect(contentHtml).toContain('<script src="assets/app.js"></script>');
    expect(await selfNavigation.text()).toContain('<script src="assets/app.js"></script>');
    expect(deps.service.resolveViewer).toHaveBeenNthCalledWith(1, "stable-slug", "");
    expect(deps.service.resolveViewer).toHaveBeenNthCalledWith(2, "stable-slug", "");
    expect(deps.service.resolveViewer).toHaveBeenNthCalledWith(3, "stable-slug", "");
  });

  it("revalidates Publication state before serving Viewer content mode", async () => {
    const deps = await dependencies();
    deps.service.resolveViewer
      .mockResolvedValueOnce({
        versionId: "version-1",
        path: "腾讯文档盘点分析报告.html",
        objectKey: "committed/version-1/腾讯文档盘点分析报告.html",
        sizeBytes: 1,
        contentType: "text/html; charset=utf-8",
        sha256: "a".repeat(64)
      })
      .mockResolvedValueOnce({ kind: "unpublished" } as never);
    const app = buildApp({ publicationViewer: deps } as never);

    const player = await app.request("/a/stable-slug/");
    const content = await app.request("/a/stable-slug/?contentMode=true");
    const contentHtml = await content.text();

    expect(player.status).toBe(200);
    expect(content.status).toBe(200);
    expect(contentHtml).toContain("not currently published");
    expect(contentHtml).not.toContain("Enter full screen");
  });

  it("streams an owner thumbnail with private immutable caching", async () => {
    const deps = await dependencies();
    const app = buildApp({ publicationViewer: deps } as never);

    const response = await app.request("/api/versions/version-1/thumbnail");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(await response.text()).toBe("thumbnail");
    expect(deps.thumbnailRepository.findOwned).toHaveBeenCalledWith("owner-1", "version-1");
  });

  it("consumes one capture grant and scopes its session to manifest assets", async () => {
    const deps = await dependencies();
    const app = buildApp({ publicationViewer: deps } as never);

    const entry = await app.request("/internal/thumbnail-captures/version-1/content/?grant=one-time");
    const cookie = entry.headers.get("set-cookie");
    const asset = await app.request("/internal/thumbnail-captures/version-1/content/assets/app.js", {
      headers: { cookie: cookie ?? "" }
    });
    const traversal = await app.request("/internal/thumbnail-captures/version-1/content/../secret");

    expect(entry.status).toBe(200);
    expect(cookie).toContain("shareslices_capture=capture-session");
    expect(deps.thumbnailRepository.consumeGrant).toHaveBeenCalledWith("one-time", "version-1");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("window.ready = true");
    expect(deps.thumbnailRepository.resolveSession).toHaveBeenCalledWith("capture-session", "version-1");
    expect(traversal.status).toBe(404);
  });

  it("streams an owned ready Version as a ZIP download", async () => {
    const deps = await dependencies();
    const app = buildApp({ publicationViewer: deps } as never);

    const response = await app.request("/api/versions/version-1/export");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain("Board-deck.zip");
    const archive = Buffer.from(await response.arrayBuffer());
    expect(archive.byteLength).toBeGreaterThan(0);
    expect(archive.includes(Buffer.from("index.html"))).toBe(true);
    expect(archive.includes(Buffer.from("assets/app.js"))).toBe(true);
    expect(archive.includes(Buffer.from("committed/version-1"))).toBe(false);
    expect(deps.service.exportVersion).toHaveBeenCalledWith("owner-1", "version-1", undefined);
  });

  it("requires owner authentication for Export", async () => {
    const deps = await dependencies(null);
    const app = buildApp({ publicationViewer: deps } as never);
    const response = await app.request("/api/versions/version-1/export?artifactId=artifact-1");
    expect(response.status).toBe(401);
    expect(deps.service.exportVersion).not.toHaveBeenCalled();
  });

  it("passes the optional Artifact constraint through Export", async () => {
    const deps = await dependencies();
    const app = buildApp({ publicationViewer: deps } as never);
    const response = await app.request("/api/versions/version-1/export?artifactId=artifact-1");
    expect(response.status).toBe(200);
    expect(deps.service.exportVersion).toHaveBeenCalledWith("owner-1", "version-1", "artifact-1");
  });

  it("publishes and supports idempotent Unpublish through management routes", async () => {
    const deps = await dependencies();
    const app = buildApp({ publicationViewer: deps } as never);

    const published = await app.request("/api/artifacts/artifact-1/publications", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "publish-key" },
      body: JSON.stringify({
        versionId: "version-1",
        expiration: { kind: "permanent" },
        link: { mode: "reuse" }
      })
    });
    const unpublished = await app.request("/api/artifacts/artifact-1/publications/publication-1", {
      method: "DELETE"
    });

    expect(published.status).toBe(201);
    await expect(published.json()).resolves.toMatchObject({
      publication: { id: "publication-1", versionId: "version-1" },
      shareLink: {
        url: "https://viewer.example/a/stable-slug/",
        state: "active"
      }
    });
    expect(deps.service.publish).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      artifactId: "artifact-1",
      versionId: "version-1",
      idempotencyKey: "publish-key",
      expiration: { kind: "permanent" },
      link: { mode: "reuse", confirmRetire: false }
    });
    expect(unpublished.status).toBe(204);
    expect(deps.service.unpublish).toHaveBeenCalledWith("owner-1", "artifact-1", "publication-1");
  });

  it.each([
    ["unpublished", 200, "not currently published"],
    ["expired", 200, "expired"],
    ["retired", 410, "no longer available"],
    ["unknown", 404, "not found"]
  ] as const)("renders a generic %s state page", async (kind, status, text) => {
    const deps = await dependencies();
    deps.service.resolveViewer.mockResolvedValue({ kind } as never);
    const app = buildApp({ publicationViewer: deps } as never);

    const response = await app.request("/a/stable-slug/");
    const html = await response.text();

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(html).toContain(text);
    expect(html).not.toContain("artifact-1");
    expect(html).not.toContain("Enter full screen");
    expect(html).toContain("http://127.0.0.1:5173");
  });
});
