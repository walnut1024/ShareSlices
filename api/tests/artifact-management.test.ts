import { describe, expect, it, vi } from "vitest";
import { ArtifactManagementError, ArtifactManagementService } from "../src/application/artifacts/artifact-management.js";
import type { ArtifactRepositories, ValidationReport } from "../src/application/artifacts/repositories.js";

function harness(options: {
  state?: string;
  retryable?: boolean;
  ready?: boolean;
  published?: boolean;
  failureReasonCode?: string;
  failureSummary?: string;
  validationReport?: ValidationReport | null;
  shareExpiresAt?: Date | null;
  shareStatus?: "active" | "expired" | "retired";
} = {}) {
  const artifact = {
    id: "artifact-1",
    ownerUserId: "owner-1",
    name: "Report",
    createdAt: new Date("2026-07-10T00:00:00Z"),
    updatedAt: new Date("2026-07-10T00:00:00Z")
  };
  const repositories = {
    artifacts: {
      listOwned: vi.fn().mockResolvedValue([artifact]),
      findOwned: vi.fn().mockResolvedValue(artifact),
      updateName: vi.fn(async (ownerId: string, artifactId: string, name: string) =>
        ownerId === "owner-1" && artifactId === "artifact-1" ? { ...artifact, name } : null
      ),
      deleteOwned: vi.fn().mockResolvedValue({
        kind: "cleanup",
        record: {
          objectKeys: ["raw/artifact-1.zip", "versions/artifact-1/index.html"],
          stagingPrefixes: ["staging/artifact-1/"]
        }
      }),
      completeDeletion: vi.fn().mockResolvedValue(undefined),
      hasReadyVersion: vi.fn()
    },
    shareLinks: {
      findActiveByArtifact: vi.fn().mockResolvedValue({
        id: "link-1",
        artifactId: "artifact-1",
        slug: "share-slug-0000000001",
        status: options.shareStatus ?? "active",
        retiredAt: null,
        expiresAt: options.shareExpiresAt ?? null
      }),
      findBySlug: vi.fn(),
      updateExpirationOwned: vi.fn().mockResolvedValue({
        id: "link-1",
        artifactId: "artifact-1",
        slug: "share-slug-0000000001",
        status: "active",
        retiredAt: null,
        expiresAt: null
      })
    },
    uploadSessions: {
      findOwned: vi.fn(),
      findCurrent: vi.fn().mockResolvedValue({
        id: "upload-1",
        artifactId: "artifact-1",
        state: options.state ?? "processing",
        retryable: options.retryable ?? false,
        rawObjectKey: "raw/artifact-1/upload-1.zip",
        rawSha256: "a".repeat(64),
        failureReasonCode: options.state === "failed" ? options.failureReasonCode ?? "object_store_timeout" : null,
        failureSummary: options.state === "failed" ? options.failureSummary ?? "Processing dependency failed." : null,
        validationReport: options.validationReport ?? null,
        supersededAt: null
      })
    },
    versions: {
      findReadyOwned: vi.fn(),
      listReadyOwned: vi.fn().mockResolvedValue(
        options.ready ? [{ id: "version-1", artifactId: "artifact-1", uploadSessionId: "upload-1", versionNumber: 1, state: "ready" }] : []
      ),
      findReadyByArtifact: vi.fn().mockResolvedValue(
        options.ready
          ? {
              id: "version-1",
              artifactId: "artifact-1",
              uploadSessionId: "upload-1",
              versionNumber: 1,
              state: "ready"
            }
          : null
      )
    },
    publications: {
      findCurrent: vi.fn().mockResolvedValue(
        options.published
          ? {
              id: "publication-1",
              artifactId: "artifact-1",
              versionId: "version-1",
              publishedByUserId: "owner-1",
              createdAt: new Date("2026-07-10T01:00:00Z"),
              endedAt: null
            }
          : null
      )
    }
  } as unknown as Pick<
    ArtifactRepositories,
    "artifacts" | "shareLinks" | "uploadSessions" | "versions" | "publications"
  >;
  const storage = { deleteObject: vi.fn(), removeStagingPrefix: vi.fn() };
  return {
    repositories,
    storage,
    service: new ArtifactManagementService({
      repositories,
      viewerOrigin: "http://10.0.0.25:8080",
      storage
    })
  };
}

describe("ArtifactManagementService", () => {
  it("lists only ready Versions for an owned Artifact", async () => {
    const { service } = harness({ ready: true });
    await expect(service.listReadyVersions("owner-1", "artifact-1")).resolves.toEqual([
      { id: "version-1", versionNumber: 1, state: "ready" }
    ]);
  });
  it("returns bounded pages with opaque tokens and rejects malformed tokens", async () => {
    const { service, repositories } = harness({ ready: true });
    const first = await repositories.artifacts.findOwned("owner-1", "artifact-1");
    vi.mocked(repositories.artifacts.listOwned).mockResolvedValue([
      first!,
      { ...first!, id: "artifact-2", name: "Second" }
    ]);

    const page = await service.list("owner-1", { processing: "ready", pageSize: 1 });
    expect(page).toMatchObject({ artifacts: [{ id: "artifact-1" }] });
    expect(page).not.toBeInstanceOf(Array);
    const token = "nextPageToken" in page ? page.nextPageToken : null;
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    await expect(service.list("owner-1", { pageSize: 1, pageToken: "not-a-token" }))
      .rejects.toEqual(new ArtifactManagementError("invalid_page_token"));
  });

  it("projects a ready unpublished Artifact with only valid actions", async () => {
    const { service } = harness({ ready: true });

    await expect(service.get("owner-1", "artifact-1")).resolves.toEqual({
      id: "artifact-1",
      name: "Report",
      updatedAt: "2026-07-10T00:00:00.000Z",
      uploadSessionId: "upload-1",
      processingState: "ready",
      shareLink: { url: "http://10.0.0.25:8080/a/share-slug-0000000001/", state: "active", expiresAt: null },
      readyVersion: { id: "version-1", state: "ready" },
      publication: null,
      failure: null,
      validationReport: null,
      allowedActions: ["rename", "copy_share_link", "preview", "publish", "export", "delete"]
    });
  });

  it("projects an elapsed active Share link as expired without rotating its URL", async () => {
    const { service } = harness({
      ready: true,
      published: true,
      shareExpiresAt: new Date("2020-01-01T00:00:00Z")
    });

    await expect(service.get("owner-1", "artifact-1")).resolves.toMatchObject({
      shareLink: {
        url: "http://10.0.0.25:8080/a/share-slug-0000000001/",
        state: "expired",
        expiresAt: "2020-01-01T00:00:00.000Z"
      },
      publication: { id: "publication-1" }
    });
  });

  it("preserves retired state even when the former expiration has elapsed", async () => {
    const { service } = harness({
      ready: true,
      published: true,
      shareStatus: "retired",
      shareExpiresAt: new Date("2020-01-01T00:00:00Z")
    });

    await expect(service.get("owner-1", "artifact-1")).resolves.toMatchObject({
      shareLink: { state: "retired", expiresAt: "2020-01-01T00:00:00.000Z" }
    });
  });

  it("edits only a future or permanent Share expiration for the owner", async () => {
    const { service, repositories } = harness({ ready: true, published: true });
    vi.mocked(repositories.shareLinks.updateExpirationOwned).mockImplementation(async (_owner, _artifact, expiration) => ({
      id: "link-1",
      artifactId: "artifact-1",
      slug: "share-slug-0000000001",
      status: "active",
      retiredAt: null,
      expiresAt: expiration
    }));

    await service.setShareExpiration("owner-1", "artifact-1", "2099-08-01T08:30:00+08:00");
    expect(repositories.shareLinks.updateExpirationOwned).toHaveBeenCalledWith(
      "owner-1",
      "artifact-1",
      new Date("2099-08-01T00:30:00Z")
    );
    await service.setShareExpiration("owner-1", "artifact-1", null);
    expect(repositories.shareLinks.updateExpirationOwned).toHaveBeenLastCalledWith("owner-1", "artifact-1", null);

    for (const invalid of ["not-a-date", "2020-01-01T00:00:00Z"]) {
      await expect(service.setShareExpiration("owner-1", "artifact-1", invalid))
        .rejects.toEqual(new ArtifactManagementError("invalid_expiration"));
    }
  });

  it("conceals a Share link from a different signed-in owner", async () => {
    const { service, repositories } = harness({ ready: true, published: true });
    vi.mocked(repositories.artifacts.findOwned).mockResolvedValue(null);
    vi.mocked(repositories.shareLinks.updateExpirationOwned).mockResolvedValue(null);

    await expect(service.get("other-owner", "artifact-1"))
      .rejects.toEqual(new ArtifactManagementError("artifact_not_found"));
    await expect(service.setShareExpiration("other-owner", "artifact-1", null))
      .rejects.toEqual(new ArtifactManagementError("artifact_not_found"));
    expect(repositories.publications.findCurrent).not.toHaveBeenCalled();
  });

  it("exposes a retryable failure summary and Retry action", async () => {
    const { service } = harness({ state: "failed", retryable: true });

    await expect(service.get("owner-1", "artifact-1")).resolves.toMatchObject({
      uploadSessionId: "upload-1",
      processingState: "failed",
      failure: {
        code: "object_store_timeout",
        message: "Processing dependency failed.",
        recoverable: true
      },
      allowedActions: ["rename", "copy_share_link", "retry", "delete"]
    });
  });

  it("replaces a legacy reason-code summary with user-facing guidance", async () => {
    const { service } = harness({
      state: "failed",
      retryable: false,
      failureReasonCode: "invalid_content",
      failureSummary: "invalid_content"
    });

    await expect(service.get("owner-1", "artifact-1")).resolves.toMatchObject({
      failure: {
        code: "invalid_content",
        message: "The ZIP contains a file with invalid content.",
        recoverable: false
      }
    });
  });

  it("projects the stored validation report unchanged while preserving the scalar failure", async () => {
    const validationReport: ValidationReport = {
      primaryIssue: {
        code: "single_file_too_large",
        message: "The file exceeds the allowed size.",
        action: "Reduce or split the file, then upload a new ZIP.",
        details: { path: "data/report.json", actualBytes: 66_479_718, limitBytes: 52_428_800 }
      },
      issues: [],
      warnings: []
    };
    const { service } = harness({
      state: "failed",
      failureReasonCode: "single_file_size_exceeded",
      failureSummary: "single_file_size_exceeded",
      validationReport
    });

    const artifact = await service.get("owner-1", "artifact-1");

    expect(artifact.validationReport).toBe(validationReport);
    expect(artifact.failure).toEqual({
      code: "single_file_size_exceeded",
      message: "The ZIP could not be processed.",
      recoverable: false
    });
  });

  it("updates expiration and permanently deletes an eligible Artifact", async () => {
    const { service, repositories, storage } = harness({ ready: true });

    const updated = await service.setShareExpiration("owner-1", "artifact-1", "2099-08-08T00:00:00.000Z");
    await service.delete("owner-1", "artifact-1");

    expect(updated.id).toBe("artifact-1");
    expect(repositories.shareLinks.updateExpirationOwned).toHaveBeenCalledWith(
      "owner-1",
      "artifact-1",
      new Date("2099-08-08T00:00:00.000Z")
    );
    expect(repositories.artifacts.deleteOwned).toHaveBeenCalledWith("owner-1", "artifact-1");
    expect(repositories.artifacts.completeDeletion).toHaveBeenCalledWith("owner-1", "artifact-1");
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(storage.removeStagingPrefix).toHaveBeenCalledWith("staging/artifact-1/");
  });

  it.each(["accepted", "processing"])(
    "rejects deletion while the current Upload is %s without touching records or objects",
    async (state) => {
      const { service, repositories, storage } = harness({ state });
      vi.mocked(repositories.artifacts.deleteOwned).mockResolvedValue({ kind: "invalid_state" });

      await expect(service.delete("owner-1", "artifact-1")).rejects.toEqual(
        new ArtifactManagementError("invalid_artifact_state")
      );
      expect(repositories.artifacts.deleteOwned).toHaveBeenCalledOnce();
      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(storage.removeStagingPrefix).not.toHaveBeenCalled();
    }
  );

  it("does not reveal or delete another owner's Artifact", async () => {
    const { service, repositories, storage } = harness({ ready: true });
    vi.mocked(repositories.artifacts.deleteOwned).mockResolvedValue({ kind: "not_found" });

    await expect(service.delete("owner-2", "artifact-1")).rejects.toEqual(
      new ArtifactManagementError("artifact_not_found")
    );
    expect(repositories.artifacts.deleteOwned).toHaveBeenCalledOnce();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("keeps durable cleanup intent when object cleanup fails", async () => {
    const { service, repositories, storage } = harness({ ready: true });
    vi.mocked(storage.deleteObject).mockRejectedValueOnce(new Error("object store unavailable"));

    await expect(service.delete("owner-1", "artifact-1")).rejects.toThrow("object store unavailable");
    expect(repositories.artifacts.deleteOwned).toHaveBeenCalledOnce();
    expect(repositories.artifacts.completeDeletion).not.toHaveBeenCalled();
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(storage.removeStagingPrefix).toHaveBeenCalledOnce();

    await expect(service.delete("owner-1", "artifact-1")).resolves.toBeUndefined();
    expect(repositories.artifacts.deleteOwned).toHaveBeenCalledTimes(2);
    expect(repositories.artifacts.completeDeletion).toHaveBeenCalledWith("owner-1", "artifact-1");
  });

  it("trims a mutable name without changing Artifact identity", async () => {
    const { service, repositories } = harness();

    const renamed = await service.rename("owner-1", "artifact-1", "  New Name  ");

    expect(renamed).toMatchObject({ id: "artifact-1", name: "New Name" });
    expect(repositories.artifacts.updateName).toHaveBeenCalledWith("owner-1", "artifact-1", "New Name");
    await expect(service.rename("owner-1", "artifact-1", "   ")).rejects.toEqual(
      new ArtifactManagementError("invalid_artifact_name")
    );
  });
});
