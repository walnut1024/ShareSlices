import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { GalleryDownloadArchiveService } from "../src/application/gallery/download-archive.js";

const acceptance = {
  leaseId: "gdownload_1",
  leaseToken: "lease-token",
  assets: [
    {
      path: "index.html",
      objectKey: "bundle/index.html",
      sizeBytes: 5,
      contentType: "text/html",
    },
  ],
  fileName: "demo.zip",
  expiresAt: new Date(Date.now() + 60_000),
};

describe("Gallery download archive orchestration", () => {
  it("settles the source lease as finished after the ZIP is consumed", async () => {
    const downloads = {
      accept: vi.fn(async () => acceptance),
      finish: vi.fn(async () => true),
    };
    const storage = {
      readCommittedObject: vi.fn(async () => ({
        body: Readable.from([Buffer.from("hello")]),
      })),
    };
    const archive = await new GalleryDownloadArchiveService(
      downloads as never,
      storage,
    ).open("slug", "source");

    for await (const _chunk of archive.body) {
      // Drain the normalized archive to trigger its terminal lifecycle.
    }
    await vi.waitFor(() =>
      expect(downloads.finish).toHaveBeenCalledWith(
        "gdownload_1",
        "lease-token",
        "finished",
      ),
    );
  });

  it("settles the source lease as aborted when object loading fails", async () => {
    const downloads = {
      accept: vi.fn(async () => acceptance),
      finish: vi.fn(async () => true),
    };
    const storage = {
      readCommittedObject: vi.fn(async () => {
        throw new Error("object unavailable");
      }),
    };
    await expect(
      new GalleryDownloadArchiveService(downloads as never, storage).open(
        "slug",
        "source",
      ),
    ).rejects.toThrow("object unavailable");
    expect(downloads.finish).toHaveBeenCalledWith(
      "gdownload_1",
      "lease-token",
      "aborted",
    );
  });

  it("retries and observes asynchronous lease settlement failures", async () => {
    const settlementError = new Error("database unavailable");
    const downloads = {
      accept: vi.fn(async () => acceptance),
      finish: vi.fn(async () => {
        throw settlementError;
      }),
    };
    const storage = {
      readCommittedObject: vi.fn(async () => ({
        body: Readable.from([Buffer.from("hello")]),
      })),
    };
    const logger = { emit: vi.fn() };
    const archive = await new GalleryDownloadArchiveService(
      downloads as never,
      storage,
      logger,
    ).open("slug", "source");

    for await (const _chunk of archive.body) {
      // Drain the archive so the lease reaches its terminal settlement path.
    }

    await vi.waitFor(() => expect(logger.emit).toHaveBeenCalledOnce());
    expect(downloads.finish).toHaveBeenCalledTimes(3);
    expect(logger.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "ERROR",
        eventName: "shareslices.gallery.download.lease_settlement.failed",
        attributes: expect.objectContaining({
          "shareslices.gallery.download.lease.id": "gdownload_1",
          "shareslices.gallery.download.outcome": "finished",
        }),
      }),
    );
  });
});
