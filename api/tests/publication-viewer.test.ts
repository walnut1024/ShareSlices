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
        publishedAt: new Date("2026-07-10T00:00:00Z")
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
    const service = new PublicationViewerService(store);

    await expect(service.preview("owner-1", "version-1", "index.html")).resolves.toMatchObject({
      objectKey: "committed/version-1/index.html"
    });
    expect(store.findAsset).toHaveBeenCalledWith("version-1", "index.html");

    vi.mocked(store.findOwnedReadyVersion).mockResolvedValueOnce(null);
    await expect(service.preview("other-user", "version-1", "index.html")).rejects.toEqual(
      new PublicationViewerError("version_not_found")
    );
  });

  it("publishes with a stable request hash and maps repository conflicts", async () => {
    const store = repository();
    const service = new PublicationViewerService(store);

    await service.publish({
      ownerUserId: "owner-1",
      artifactId: "artifact-1",
      versionId: "version-1",
      idempotencyKey: "publish-key"
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
        idempotencyKey: "publish-key"
      })
    ).rejects.toEqual(new PublicationViewerError("idempotency_conflict"));
  });

  it("fixes Viewer asset resolution to the Version returned for that request", async () => {
    const store = repository();
    const service = new PublicationViewerService(store);

    await service.resolveViewer("stable-slug", "index.html");

    expect(store.resolveShareSlug).toHaveBeenCalledWith("stable-slug");
    expect(store.findAsset).toHaveBeenCalledWith("version-1", "index.html");
  });
});
