import type { ObjectStorage } from "../../storage/object-storage.js";
import type {
  ArtifactRecord,
  ArtifactRepositories,
  PublicationRecord,
  ShareLinkRecord,
  UploadSessionRecord,
  ValidationReport,
  VersionRecord
} from "./repositories.js";

type ManagementRepositories = Pick<
  ArtifactRepositories,
  "artifacts" | "shareLinks" | "uploadSessions" | "versions" | "publications" | "publicSharingRestrictions"
>;

type ArtifactManagementOptions = {
  repositories: ManagementRepositories;
  viewerOrigin: string;
  storage: Pick<ObjectStorage, "deleteObject" | "removeStagingPrefix">;
};

export type ArtifactAction =
  | "rename"
  | "retry"
  | "replace_file"
  | "preview"
  | "publish"
  | "unpublish"
  | "manage_publication"
  | "copy_share_link"
  | "export"
  | "delete";

export type ArtifactManagementState = {
  id: string;
  name: string;
  updatedAt: string;
  uploadSessionId: string | null;
  processingState: "accepted" | "processing" | "ready" | "failed";
  shareLink: { url: string; state: "active" | "retired" } | null;
  publicationStatus: "not_published" | "published" | "expired" | "unpublished";
  readyVersion: { id: string; state: "ready"; thumbnailState: "pending" | "ready" | "failed" } | null;
  publication: {
    id: string;
    versionId: string;
    publishedAt: string;
    expirationKind: "permanent" | "duration" | "exact";
    durationSeconds: number | null;
    expiresAt: string | null;
    endedAt: string | null;
    endReason: "unpublished" | "superseded" | null;
  } | null;
  failure: { code: string; message: string; recoverable: boolean } | null;
  validationReport: ValidationReport | null;
  publicSharingRestriction: { state: "restricted" } | null;
  allowedActions: ArtifactAction[];
};

export type ArtifactListOptions = {
  publication?: "published" | "unpublished" | undefined;
  processing?: ArtifactManagementState["processingState"] | undefined;
  pageSize: number;
  pageToken?: string | undefined;
};

export class ArtifactManagementError extends Error {
  constructor(readonly code: "artifact_not_found" | "invalid_artifact_name" | "invalid_artifact_state" | "invalid_page_token") {
    super({
      artifact_not_found: "Artifact not found.",
      invalid_artifact_name: "Artifact name must contain 1 to 120 characters.",
      invalid_artifact_state: "Artifact cannot be deleted while processing.",
      invalid_page_token: "Artifact page token is invalid."
    }[code]);
    this.name = "ArtifactManagementError";
  }
}

function processingState(session: UploadSessionRecord | null, version: VersionRecord | null): ArtifactManagementState["processingState"] {
  if (version) {
    return "ready";
  }
  if (!session || session.state === "accepted") {
    return "accepted";
  }
  if (session.state === "failed") {
    return "failed";
  }
  return "processing";
}

function actions(
  state: ArtifactManagementState["processingState"],
  session: UploadSessionRecord | null,
  publication: PublicationRecord | null,
  restricted: boolean
): ArtifactAction[] {
  const result: ArtifactAction[] = ["rename"];
  const publicationStatus = statusOf(publication);
  if (publicationStatus === "published") {
    result.push("manage_publication", "unpublish");
    if (!restricted) result.push("copy_share_link");
  }
  if (state === "failed") {
    result.push(session?.retryable ? "retry" : "replace_file");
  } else if (state === "ready") {
    result.push("preview");
    if (!restricted) result.push("publish");
  }
  if (state === "ready") result.push("export");
  if (state === "ready" || state === "failed") result.push("delete");
  return result;
}

function statusOf(publication: PublicationRecord | null): ArtifactManagementState["publicationStatus"] {
  if (!publication) return "not_published";
  if (publication.endReason === "unpublished" || publication.endedAt !== null) return "unpublished";
  if (publication.expiresAt !== null && publication.expiresAt <= new Date()) return "expired";
  return "published";
}

function failureMessage(session: UploadSessionRecord): string | null {
  if (!session.failureReasonCode || !session.failureSummary) return null;
  if (session.failureSummary !== session.failureReasonCode) return session.failureSummary;
  if (session.failureReasonCode === "invalid_content") return "The ZIP contains a file with invalid content.";
  return session.retryable ? "Processing could not be completed." : "The ZIP could not be processed.";
}

export class ArtifactManagementService {
  readonly #repositories: ManagementRepositories;
  readonly #viewerOrigin: string;
  readonly #storage: Pick<ObjectStorage, "deleteObject" | "removeStagingPrefix">;

  constructor(options: ArtifactManagementOptions) {
    this.#repositories = options.repositories;
    this.#viewerOrigin = options.viewerOrigin;
    this.#storage = options.storage;
  }

  async list(ownerUserId: string, options: ArtifactListOptions): Promise<{ artifacts: ArtifactManagementState[]; nextPageToken: string | null }> {
    const cursor = options.pageToken ? this.#decodePageToken(options.pageToken) : undefined;
    const candidates = await this.#repositories.artifacts.listOwnedPage({
      ownerUserId,
      ...(options.publication ? { publication: options.publication } : {}),
      ...(options.processing ? { processing: options.processing } : {}),
      ...(cursor ? { cursor } : {}),
      limit: options.pageSize + 1
    });
    const hasMore = candidates.length > options.pageSize;
    const page = candidates.slice(0, options.pageSize);
    const artifactIds = page.map(({ id }) => id);
    const [shareLinks, uploadSessions, versions, publications, restrictedIds] = await Promise.all([
      this.#repositories.shareLinks.findActiveByArtifacts(artifactIds),
      this.#repositories.uploadSessions.findCurrentByArtifacts(artifactIds),
      this.#repositories.versions.findReadyByArtifacts(artifactIds),
      this.#repositories.publications.findLatestByArtifacts(artifactIds),
      this.#repositories.publicSharingRestrictions.findRestrictedByArtifacts(artifactIds)
    ]);
    const shareByArtifact = new Map(shareLinks.map((value) => [value.artifactId, value]));
    const sessionByArtifact = new Map(uploadSessions.map((value) => [value.artifactId, value]));
    const versionByArtifact = new Map(versions.map((value) => [value.artifactId, value]));
    const publicationByArtifact = new Map(publications.map((value) => [value.artifactId, value]));
    const restricted = new Set(restrictedIds);
    const artifacts = page.map((artifact) => this.#projectState(
      artifact,
      shareByArtifact.get(artifact.id) ?? null,
      sessionByArtifact.get(artifact.id) ?? null,
      versionByArtifact.get(artifact.id) ?? null,
      publicationByArtifact.get(artifact.id) ?? null,
      restricted.has(artifact.id)
    ));
    const last = page.at(-1);
    return {
      artifacts,
      nextPageToken: hasMore && last ? this.#encodePageToken(last) : null
    };
  }

  #encodePageToken(artifact: ArtifactRecord): string {
    return Buffer.from(JSON.stringify({ updatedAt: artifact.updatedAt.toISOString(), artifactId: artifact.id }), "utf8").toString("base64url");
  }

  #decodePageToken(token: string): { updatedAt: Date; artifactId: string } {
    try {
      const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
      if (typeof value.updatedAt === "string" && typeof value.artifactId === "string" && value.artifactId.length > 0) {
        const updatedAt = new Date(value.updatedAt);
        if (Number.isFinite(updatedAt.getTime()) && updatedAt.toISOString() === value.updatedAt) {
          return { updatedAt, artifactId: value.artifactId };
        }
      }
    } catch {
      throw new ArtifactManagementError("invalid_page_token");
    }
    throw new ArtifactManagementError("invalid_page_token");
  }

  async get(ownerUserId: string, artifactId: string): Promise<ArtifactManagementState> {
    const artifact = await this.#repositories.artifacts.findOwned(ownerUserId, artifactId);
    if (!artifact) {
      throw new ArtifactManagementError("artifact_not_found");
    }
    return this.#state(artifact);
  }

  async listReadyVersions(ownerUserId: string, artifactId: string) {
    const artifact = await this.#repositories.artifacts.findOwned(ownerUserId, artifactId);
    if (!artifact) throw new ArtifactManagementError("artifact_not_found");
    const versions = await this.#repositories.versions.listReadyOwned(ownerUserId, artifactId);
    return versions.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      state: "ready" as const
    }));
  }

  async rename(ownerUserId: string, artifactId: string, requestedName: string): Promise<ArtifactManagementState> {
    const name = requestedName.trim();
    if (name.length < 1 || name.length > 120) {
      throw new ArtifactManagementError("invalid_artifact_name");
    }
    const artifact = await this.#repositories.artifacts.updateName(ownerUserId, artifactId, name);
    if (!artifact) {
      throw new ArtifactManagementError("artifact_not_found");
    }
    return this.#state(artifact);
  }

  async delete(ownerUserId: string, artifactId: string): Promise<void> {
    const result = await this.#repositories.artifacts.deleteOwned(ownerUserId, artifactId);
    if (result.kind === "not_found") throw new ArtifactManagementError("artifact_not_found");
    if (result.kind === "invalid_state") throw new ArtifactManagementError("invalid_artifact_state");
    await Promise.all([
      ...result.record.objectKeys.map((key) => this.#storage.deleteObject(key)),
      ...result.record.stagingPrefixes.map((prefix) => this.#storage.removeStagingPrefix(prefix))
    ]);
    await this.#repositories.artifacts.completeDeletion(ownerUserId, artifactId);
  }

  async #state(artifact: ArtifactRecord): Promise<ArtifactManagementState> {
    const [shareLink, uploadSession, version, publication, restrictedIds] = await Promise.all([
      this.#repositories.shareLinks.findActiveByArtifact(artifact.id),
      this.#repositories.uploadSessions.findCurrent(artifact.id),
      this.#repositories.versions.findReadyByArtifact(artifact.id),
      this.#repositories.publications.findLatest(artifact.id),
      this.#repositories.publicSharingRestrictions.findRestrictedByArtifacts([artifact.id])
    ]);
    return this.#projectState(artifact, shareLink, uploadSession, version, publication, restrictedIds.length > 0);
  }

  #projectState(
    artifact: ArtifactRecord,
    shareLink: ShareLinkRecord | null,
    uploadSession: UploadSessionRecord | null,
    version: VersionRecord | null,
    publication: PublicationRecord | null,
    restricted: boolean
  ): ArtifactManagementState {
    const state = processingState(uploadSession, version);
    const message = uploadSession ? failureMessage(uploadSession) : null;
    return {
      id: artifact.id,
      name: artifact.name,
      updatedAt: artifact.updatedAt.toISOString(),
      uploadSessionId: uploadSession?.id ?? null,
      processingState: state,
      shareLink: shareLink ? this.#shareLink(shareLink) : null,
      publicationStatus: statusOf(publication),
      readyVersion: version ? { id: version.id, state: "ready", thumbnailState: version.thumbnailState ?? "pending" } : null,
      publication: publication
        ? {
            id: publication.id,
            versionId: publication.versionId,
            publishedAt: publication.createdAt.toISOString(),
            expirationKind: publication.expirationKind,
            durationSeconds: publication.durationSeconds,
            expiresAt: publication.expiresAt?.toISOString() ?? null,
            endedAt: publication.endedAt?.toISOString() ?? null,
            endReason: publication.endReason
          }
        : null,
      failure:
        state === "failed" && uploadSession?.failureReasonCode && message
          ? {
              code: uploadSession.failureReasonCode,
              message,
              recoverable: uploadSession.retryable
            }
          : null,
      validationReport: uploadSession?.validationReport ?? null,
      publicSharingRestriction: restricted ? { state: "restricted" } : null,
      allowedActions: actions(state, uploadSession, publication, restricted)
    };
  }

  #shareLink(link: ShareLinkRecord): ArtifactManagementState["shareLink"] {
    return {
      url: new URL(`/a/${link.slug}/`, this.#viewerOrigin).toString(),
      state: link.status as "active" | "retired"
    };
  }
}
