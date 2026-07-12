import { createHash, randomUUID } from "node:crypto";

export type ContentAsset = {
  versionId: string;
  path: string;
  objectKey: string;
  sizeBytes: number;
  contentType: string;
  sha256: string;
};

export type ReadyVersionAccess = {
  id: string;
  artifactId: string;
};

export type VersionExport = {
  artifactId: string;
  artifactName: string;
  assets: ContentAsset[];
};

export type PublicationView = {
  id: string;
  versionId: string;
  publishedAt: Date;
};

export type ShareResolution =
  | { kind: "unknown" }
  | { kind: "expired" }
  | { kind: "retired" }
  | { kind: "unpublished" }
  | { kind: "published"; versionId: string };

export type ViewerResolution = Exclude<ShareResolution, { kind: "published" }> | ContentAsset;

export type PublishResult =
  | { kind: "published"; publication: PublicationView }
  | { kind: "artifact_not_found" }
  | { kind: "version_not_ready" }
  | { kind: "operation_in_progress" }
  | { kind: "idempotency_conflict" };

export interface PublicationContentRepository {
  findOwnedReadyVersion(ownerUserId: string, versionId: string): Promise<ReadyVersionAccess | null>;
  findAsset(versionId: string, path: string): Promise<ContentAsset | null>;
  findEntryAsset(versionId: string): Promise<ContentAsset | null>;
  findOwnedVersionExport(ownerUserId: string, versionId: string): Promise<VersionExport | null>;
  publish(input: {
    id: string;
    ownerUserId: string;
    artifactId: string;
    versionId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<PublishResult>;
  unpublish(ownerUserId: string, artifactId: string, publicationId: string): Promise<boolean>;
  resolveShareSlug(shareSlug: string): Promise<ShareResolution>;
}

export type PublicationViewerErrorCode =
  | "artifact_not_found"
  | "version_not_found"
  | "version_not_ready"
  | "asset_not_found"
  | "operation_in_progress"
  | "idempotency_conflict";

export class PublicationViewerError extends Error {
  constructor(readonly code: PublicationViewerErrorCode) {
    super(code);
  }
}

function publishRequestHash(artifactId: string, versionId: string): string {
  return createHash("sha256").update(JSON.stringify({ artifactId, versionId })).digest("hex");
}

export function normalizeContentPath(rawPath: string): string | null {
  let path = rawPath;
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (path.length === 0 || path.startsWith("/") || path.endsWith("/") || path.includes("\\") || path.includes("\0")) {
    return null;
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }
  return segments.join("/");
}

export class PublicationViewerService {
  constructor(private readonly repository: PublicationContentRepository) {}

  async preview(ownerUserId: string, versionId: string, rawPath: string): Promise<ContentAsset> {
    const version = await this.repository.findOwnedReadyVersion(ownerUserId, versionId);
    if (!version) {
      throw new PublicationViewerError("version_not_found");
    }
    const path = rawPath.length === 0 ? null : normalizeContentPath(rawPath);
    if (rawPath.length > 0 && !path) {
      throw new PublicationViewerError("asset_not_found");
    }
    const asset = path
      ? await this.repository.findAsset(version.id, path)
      : await this.repository.findEntryAsset(version.id);
    if (!asset) {
      throw new PublicationViewerError("asset_not_found");
    }
    return asset;
  }

  async exportVersion(ownerUserId: string, versionId: string, artifactId?: string): Promise<VersionExport> {
    const exported = await this.repository.findOwnedVersionExport(ownerUserId, versionId);
    if (!exported || (artifactId !== undefined && exported.artifactId !== artifactId)) {
      throw new PublicationViewerError("version_not_found");
    }
    return exported;
  }

  async publish(input: {
    ownerUserId: string;
    artifactId: string;
    versionId: string;
    idempotencyKey: string;
  }): Promise<PublicationView> {
    const result = await this.repository.publish({
      id: `pub_${randomUUID().replaceAll("-", "")}`,
      ...input,
      requestHash: publishRequestHash(input.artifactId, input.versionId)
    });
    if (result.kind !== "published") {
      throw new PublicationViewerError(result.kind);
    }
    return result.publication;
  }

  async unpublish(ownerUserId: string, artifactId: string, publicationId: string): Promise<void> {
    if (!(await this.repository.unpublish(ownerUserId, artifactId, publicationId))) {
      throw new PublicationViewerError("artifact_not_found");
    }
  }

  async resolveViewer(shareSlug: string, rawPath: string): Promise<ViewerResolution> {
    const resolution = await this.repository.resolveShareSlug(shareSlug);
    if (resolution.kind !== "published") {
      return resolution;
    }
    const path = rawPath.length === 0 ? null : normalizeContentPath(rawPath);
    if (rawPath.length > 0 && !path) {
      throw new PublicationViewerError("asset_not_found");
    }
    const asset = path
      ? await this.repository.findAsset(resolution.versionId, path)
      : await this.repository.findEntryAsset(resolution.versionId);
    if (!asset) {
      throw new PublicationViewerError("asset_not_found");
    }
    return asset;
  }
}
