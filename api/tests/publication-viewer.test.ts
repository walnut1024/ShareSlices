import { describe, expect, it, vi } from "vitest";
import {
  normalizeContentPath,
  PublicationViewerError,
  PublicationViewerService,
  type PublicationContentRepository
} from "../src/application/artifacts/publication-viewer.js";

function repository(): PublicationContentRepository {
  return {
    findOwnedReadyVersion: vi.fn().mockResolvedValue({ id: "version-1", artifactId: "artifact-1" }),
    findOwnedVersionExport: vi.fn().mockResolvedValue({ artifactId: "artifact-1", artifactName: "Report", assets: [] }),
    findEntryAsset: vi.fn().mockResolvedValue({
      versionId: "version-1", path: "腾讯文档盘点分析报告.html",
      objectKey: "committed/version-1/腾讯文档盘点分析报告.html", sizeBytes: 14,
      contentType: "text/html", sha256: "a".repeat(64)
    }),
    updateExpiration: vi.fn().mockResolvedValue({
      id: "publication-1",
      versionId: "version-1",
      publishedAt: new Date("2026-07-10T00:00:00Z"),
      expirationKind: "permanent",
      durationSeconds: null,
      expiresAt: null,
      endedAt: null,
      endReason: null
    }),
    findAsset: vi.fn().mockResolvedValue({
      versionId: "version-1",
      path: "index.html",
      objectKey: "committed/version-1/index.html",
      sizeBytes: 14,
      contentType: "text/html",
      sha256: "a".repeat(64)
    }),
    publish: vi.fn().mockResolvedValue({
      kind: "published",
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
        shareSlug: "stable-slug",
        state: "active"
      }
    }),
    unpublish: vi.fn().mockResolvedValue(true),
    resolveShareSlug: vi.fn().mockResolvedValue({ kind: "published", versionId: "version-1" })
  };
}

describe("PublicationViewerService", () => {
  it("normalizes only relative manifest paths", () => {
    expect(normalizeContentPath("assets/app.js")).toBe("assets/app.js");
    expect(normalizeContentPath(["images", "chart.png"].join("%2F"))).toBe("images/chart.png");
    expect(normalizeContentPath("../secret.txt")).toBeNull();
    expect(normalizeContentPath("%2e%2e/secret.txt")).toBeNull();
    expect(normalizeContentPath("/assets/app.js")).toBeNull();
    expect(normalizeContentPath("assets\\app.js")).toBeNull();
  });

  it("checks owner-ready access before reading a Preview asset", async () => {
    const store = repository();
    const service = new PublicationViewerService(store, "https://viewer.example");

    await expect(service.preview("owner-1", "version-1", "index.html")).resolves.toMatchObject({
      objectKey: "committed/version-1/index.html"
    });
    expect(store.findAsset).toHaveBeenCalledWith("version-1", "index.html");

    vi.mocked(store.findOwnedReadyVersion).mockResolvedValueOnce(null);
    await expect(service.preview("other-user", "version-1", "index.html")).rejects.toEqual(
      new PublicationViewerError("version_not_found")
    );
  });

  it("exports only when the explicit Artifact owns the ready Version", async () => {
    const store = repository();
    const service = new PublicationViewerService(store, "https://viewer.example");
    await expect(service.exportVersion("owner-1", "version-1", "artifact-1")).resolves.toMatchObject({
      artifactId: "artifact-1",
      artifactName: "Report"
    });
    await expect(service.exportVersion("owner-1", "version-1", "artifact-other")).rejects.toEqual(
      new PublicationViewerError("version_not_found")
    );
  });

  it("resolves Preview and Viewer roots through the manifest entry", async () => {
    const store = repository();
    const service = new PublicationViewerService(store, "https://viewer.example");
    await expect(service.preview("owner-1", "version-1", "")).resolves.toMatchObject({
      path: "腾讯文档盘点分析报告.html"
    });
    await expect(service.resolveViewer("stable-slug", "")).resolves.toMatchObject({
      path: "腾讯文档盘点分析报告.html"
    });
    expect(store.findEntryAsset).toHaveBeenCalledTimes(2);
  });

  it("publishes with a stable request hash and maps repository conflicts", async () => {
    const store = repository();
    const service = new PublicationViewerService(store, "https://viewer.example");

    await expect(service.publish({
      ownerUserId: "owner-1",
      artifactId: "artifact-1",
      versionId: "version-1",
      idempotencyKey: "publish-key",
      expiration: { kind: "permanent" },
      link: { mode: "reuse", confirmRetire: false }
    })).resolves.toEqual({
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
    });
    expect(store.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        artifactId: "artifact-1",
        versionId: "version-1",
        idempotencyKey: "publish-key",
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/)
      })
    );

    vi.mocked(store.publish).mockResolvedValueOnce({ kind: "idempotency_conflict" });
    await expect(
      service.publish({
        ownerUserId: "owner-1",
        artifactId: "artifact-1",
        versionId: "version-2",
        idempotencyKey: "publish-key",
        expiration: { kind: "permanent" },
        link: { mode: "reuse", confirmRetire: false }
      })
    ).rejects.toEqual(new PublicationViewerError("idempotency_conflict"));
  });

  it("fixes Viewer asset resolution to the Version returned for that request", async () => {
    const store = repository();
    const service = new PublicationViewerService(store, "https://viewer.example");

    await service.resolveViewer("stable-slug", "index.html");

    expect(store.resolveShareSlug).toHaveBeenCalledWith("stable-slug");
    expect(store.findAsset).toHaveBeenCalledWith("version-1", "index.html");
  });
});
