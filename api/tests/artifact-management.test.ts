import { describe, expect, it, vi } from "vitest";
import { ArtifactManagementError, ArtifactManagementService } from "../src/application/artifacts/artifact-management.js";
import type { ArtifactRepositories } from "../src/application/artifacts/repositories.js";

function harness(options: { state?: string; retryable?: boolean; ready?: boolean; published?: boolean } = {}) {
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
      hasReadyVersion: vi.fn()
    },
    shareLinks: {
      findActiveByArtifact: vi.fn().mockResolvedValue({
        id: "link-1",
        artifactId: "artifact-1",
        slug: "share-slug-0000000001",
        status: "active",
        retiredAt: null,
        expiresAt: null
      }),
      findBySlug: vi.fn()
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
        failureReasonCode: options.state === "failed" ? "object_store_timeout" : null,
        failureSummary: options.state === "failed" ? "Processing dependency failed." : null,
        supersededAt: null
      })
    },
    versions: {
      findReadyOwned: vi.fn(),
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
  return {
    repositories,
    service: new ArtifactManagementService({ repositories, viewerOrigin: "http://10.0.0.25:8080" })
  };
}

describe("ArtifactManagementService", () => {
  it("projects a ready unpublished Artifact with only valid actions", async () => {
    const { service } = harness({ ready: true });

    await expect(service.get("owner-1", "artifact-1")).resolves.toEqual({
      id: "artifact-1",
      name: "Report",
      uploadSessionId: "upload-1",
      processingState: "ready",
      shareLink: { url: "http://10.0.0.25:8080/a/share-slug-0000000001/", state: "active" },
      readyVersion: { id: "version-1", state: "ready" },
      publication: null,
      failure: null,
      allowedActions: ["rename", "copy_share_link", "preview", "publish"]
    });
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
      allowedActions: ["rename", "copy_share_link", "retry"]
    });
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
