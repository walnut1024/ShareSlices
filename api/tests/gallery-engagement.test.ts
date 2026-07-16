import { describe, expect, it, vi } from "vitest";
import { GalleryContentCredentialService } from "../src/application/gallery/content-credentials.js";
import { GalleryDownloadService } from "../src/application/gallery/download.js";

describe("Gallery non-identifying engagement boundaries", () => {
  it("counts one view only when a new public credential is issued", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("select listing.id"))
          return {
            rows: [
              { id: "listing-1", listing_revision: 2, version_id: "version-1" },
            ],
          };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const service = new GalleryContentCredentialService({
      connect: vi.fn().mockResolvedValue(client),
    } as never);
    const issued = await service.issuePublic("opaque-listing");
    expect(issued?.credential).toBeTruthy();
    expect(statements.filter((sql) => sql.includes("view_count"))).toHaveLength(
      1,
    );
    expect(
      statements.filter((sql) => sql.includes("gallery_player_credential")),
    ).toHaveLength(1);
  });

  it("counts Download at authorization and not again when its lease finishes", async () => {
    const transactionStatements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        transactionStatements.push(sql);
        if (
          sql.includes("gallery_download_rate_evidence") &&
          sql.includes("count(*)")
        )
          return { rows: [{ count: "0" }] };
        if (sql.includes("instance_count"))
          return { rows: [{ instance_count: "0", deployment_count: "0" }] };
        if (sql.includes("select listing.id"))
          return {
            rows: [
              {
                id: "listing-1",
                lifecycle_state: "listed",
                review_state: "clear",
                listing_revision: 2,
                artifact_id: "artifact-1",
                version_id: "version-1",
                public_title: "Demo",
              },
            ],
          };
        if (sql.includes("select exists"))
          return { rows: [{ blocked: false }] };
        if (sql.includes("content_bundle_asset"))
          return {
            rows: [
              {
                path: "index.html",
                object_key: "objects/index.html",
                size_bytes: 10,
                content_type: "text/html",
              },
            ],
          };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const finish = vi.fn().mockResolvedValue({ rowCount: 1 });
    const service = new GalleryDownloadService(
      { connect: vi.fn().mockResolvedValue(client), query: finish } as never,
      "api-1",
    );
    await service.accept("opaque-listing", "viewer-rate-key");
    expect(
      transactionStatements.filter((sql) => sql.includes("download_count")),
    ).toHaveLength(1);
    await service.finish("lease-1", "token", "finished");
    expect(finish).toHaveBeenCalledOnce();
    expect(
      transactionStatements.filter((sql) => sql.includes("download_count")),
    ).toHaveLength(1);
  });
});
