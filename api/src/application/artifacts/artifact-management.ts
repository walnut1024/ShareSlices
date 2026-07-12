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
  "artifacts" | "shareLinks" | "uploadSessions" | "versions" | "publications"
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
  | "copy_share_link"
  | "export"
  | "delete";

export type ArtifactManagementState = {
  id: string;
  name: string;
  updatedAt: string;
  uploadSessionId: string | null;
  processingState: "accepted" | "processing" | "ready" | "failed";
  shareLink: { url: string; state: "active" | "expired" | "retired"; expiresAt: string | null };
  readyVersion: { id: string; state: "ready" } | null;
  publication: { id: string; versionId: string; publishedAt: string } | null;
  failure: { code: string; message: string; recoverable: boolean } | null;
  validationReport: ValidationReport | null;
  allowedActions: ArtifactAction[];
};

export type ArtifactListOptions = {
  publication?: "published" | "unpublished" | undefined;
  processing?: ArtifactManagementState["processingState"] | undefined;
  pageSize: number;
  pageToken?: string | undefined;
};

export class ArtifactManagementError extends Error {
  constructor(readonly code: "artifact_not_found" | "invalid_artifact_name" | "invalid_expiration" | "invalid_artifact_state" | "invalid_page_token") {
    super({
      artifact_not_found: "Artifact not found.",
      invalid_artifact_name: "Artifact name must contain 1 to 120 characters.",
      invalid_expiration: "Share link expiration must be in the future.",
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
  publication: PublicationRecord | null
): ArtifactAction[] {
  const result: ArtifactAction[] = ["rename", "copy_share_link"];
  if (state === "failed") {
    result.push(session?.retryable ? "retry" : "replace_file");
  } else if (state === "ready") {
    result.push("preview", publication ? "unpublish" : "publish");
  }
  if (state === "ready") result.push("export");
  if (state === "ready" || state === "failed") result.push("delete");
  return result;
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
    const artifacts = await this.#repositories.artifacts.listOwned(ownerUserId);
    const states = await Promise.all(artifacts.map((artifact) => this.#state(artifact)));
    const offset = options.pageToken ? this.#decodePageToken(options.pageToken) : 0;
    const matching = states.filter((artifact) =>
      (!options.publication || (options.publication === "published") === Boolean(artifact.publication)) &&
      (!options.processing || artifact.processingState === options.processing)
    );
    const page = matching.slice(offset, offset + options.pageSize);
    const nextOffset = offset + page.length;
    return { artifacts: page, nextPageToken: nextOffset < matching.length ? this.#encodePageToken(nextOffset) : null };
  }

  #encodePageToken(offset: number): string {
    return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
  }

  #decodePageToken(token: string): number {
    try {
      const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
      if (typeof value.offset === "number" && Number.isSafeInteger(value.offset) && value.offset >= 0) return value.offset;
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

  async setShareExpiration(ownerUserId: string, artifactId: string, requestedExpiration: string | null): Promise<ArtifactManagementState> {
    const expiresAt = requestedExpiration === null ? null : new Date(requestedExpiration);
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) {
      throw new ArtifactManagementError("invalid_expiration");
    }
    if (!(await this.#repositories.shareLinks.updateExpirationOwned(ownerUserId, artifactId, expiresAt))) {
      throw new ArtifactManagementError("artifact_not_found");
    }
    return this.get(ownerUserId, artifactId);
  }

  async delete(ownerUserId: string, artifactId: string): Promise<void> {
    const current = await this.get(ownerUserId, artifactId);
    if (current.processingState === "accepted" || current.processingState === "processing") {
      throw new ArtifactManagementError("invalid_artifact_state");
    }
    const deleted = await this.#repositories.artifacts.deleteOwned(ownerUserId, artifactId);
    if (!deleted) throw new ArtifactManagementError("artifact_not_found");
    await Promise.all([
      ...deleted.objectKeys.map((key) => this.#storage.deleteObject(key)),
      ...deleted.stagingPrefixes.map((prefix) => this.#storage.removeStagingPrefix(prefix))
    ]);
  }

  async #state(artifact: ArtifactRecord): Promise<ArtifactManagementState> {
    const [shareLink, uploadSession, version, publication] = await Promise.all([
      this.#repositories.shareLinks.findActiveByArtifact(artifact.id),
      this.#repositories.uploadSessions.findCurrent(artifact.id),
      this.#repositories.versions.findReadyByArtifact(artifact.id),
      this.#repositories.publications.findCurrent(artifact.id)
    ]);
    if (!shareLink) {
      throw new Error("Artifact has no active Share link.");
    }
    const state = processingState(uploadSession, version);
    const message = uploadSession ? failureMessage(uploadSession) : null;
    return {
      id: artifact.id,
      name: artifact.name,
      updatedAt: artifact.updatedAt.toISOString(),
      uploadSessionId: uploadSession?.id ?? null,
      processingState: state,
      shareLink: this.#shareLink(shareLink),
      readyVersion: version ? { id: version.id, state: "ready" } : null,
      publication: publication
        ? { id: publication.id, versionId: publication.versionId, publishedAt: publication.createdAt.toISOString() }
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
      allowedActions: actions(state, uploadSession, publication)
    };
  }

  #shareLink(link: ShareLinkRecord): ArtifactManagementState["shareLink"] {
    const state = link.status === "active" && link.expiresAt !== null && link.expiresAt <= new Date()
      ? "expired"
      : link.status;
    return {
      url: new URL(`/a/${link.slug}/`, this.#viewerOrigin).toString(),
      state: state as ArtifactManagementState["shareLink"]["state"],
      expiresAt: link.expiresAt?.toISOString() ?? null
    };
  }
}
