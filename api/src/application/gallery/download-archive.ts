import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { apiLogger, type ApiLogger } from "../../logging/index.js";
import type { ObjectStorage } from "../../storage/object-storage.js";
import { GalleryDownloadService } from "./download.js";

export class GalleryDownloadArchiveService {
  constructor(
    private readonly downloads: GalleryDownloadService,
    private readonly storage: Pick<ObjectStorage, "readCommittedObject">,
    private readonly logger: ApiLogger = apiLogger,
  ) {}

  async open(
    gallerySlug: string,
    sourceKey: string,
  ): Promise<{ body: Readable; fileName: string }> {
    const accepted = await this.downloads.accept(gallerySlug, sourceKey);
    try {
      const archive = new ZipArchive({ zlib: { level: 9 } });
      for (const asset of accepted.assets) {
        const object = await this.storage.readCommittedObject(asset.objectKey);
        archive.append(Readable.from(object.body), { name: asset.path });
      }
      let settled = false;
      const settle = (outcome: "finished" | "aborted") => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void this.finishWithRetry(
          accepted.leaseId,
          accepted.leaseToken,
          outcome,
        )
          .catch((error: unknown) => {
            this.logger.emit({
              severity: "ERROR",
              body: "Gallery download lease settlement failed.",
              eventName: "shareslices.gallery.download.lease_settlement.failed",
              attributes: {
                "shareslices.gallery.download.lease.id": accepted.leaseId,
                "shareslices.gallery.download.outcome": outcome,
                "shareslices.gallery.download.reason_code":
                  error instanceof Error
                    ? "lease_settlement_rejected"
                    : "lease_settlement_failed",
              },
            });
          });
      };
      const timeout = setTimeout(
        () => archive.destroy(new Error("gallery_download_duration_exceeded")),
        Math.max(1, accepted.expiresAt.getTime() - Date.now()),
      );
      timeout.unref();
      archive.once("end", () => settle("finished"));
      archive.once("error", () => settle("aborted"));
      archive.once("close", () => settle("aborted"));
      void archive.finalize().catch((error: unknown) =>
        archive.destroy(error instanceof Error ? error : new Error("archive_failed")),
      );
      return { body: archive, fileName: accepted.fileName };
    } catch (error) {
      await this.downloads.finish(
        accepted.leaseId,
        accepted.leaseToken,
        "aborted",
      );
      throw error;
    }
  }

  private async finishWithRetry(
    leaseId: string,
    leaseToken: string,
    outcome: "finished" | "aborted",
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.downloads.finish(leaseId, leaseToken, outcome);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}
