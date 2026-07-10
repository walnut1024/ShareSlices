import type {
  ArtifactRecord,
  ArtifactRepositories,
  PublicationRecord,
  ShareLinkRecord,
  UploadSessionRecord,
  VersionRecord
} from "./repositories.js";

type ManagementRepositories = Pick<
  ArtifactRepositories,
  "artifacts" | "shareLinks" | "uploadSessions" | "versions" | "publications"
>;

type ArtifactManagementOptions = {
  repositories: ManagementRepositories;
  viewerOrigin: string;
};

export type ArtifactAction =
  | "rename"
  | "retry"
  | "replace_file"
  | "preview"
  | "publish"
  | "unpublish"
  | "copy_share_link";

export type ArtifactManagementState = {
  id: string;
  name: string;
  uploadSessionId: string | null;
  processingState: "accepted" | "processing" | "ready" | "failed";
  shareLink: { url: string; state: "active" | "expired" | "retired" };
  readyVersion: { id: string; state: "ready" } | null;
  publication: { id: string; versionId: string; publishedAt: string } | null;
  failure: { code: string; message: string; recoverable: boolean } | null;
  allowedActions: ArtifactAction[];
};

export class ArtifactManagementError extends Error {
  constructor(readonly code: "artifact_not_found" | "invalid_artifact_name") {
    super(code === "artifact_not_found" ? "Artifact not found." : "Artifact name must contain 1 to 120 characters.");
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
  return result;
}

export class ArtifactManagementService {
  readonly #repositories: ManagementRepositories;
  readonly #viewerOrigin: string;

  constructor(options: ArtifactManagementOptions) {
    this.#repositories = options.repositories;
    this.#viewerOrigin = options.viewerOrigin;
  }

  async list(ownerUserId: string): Promise<ArtifactManagementState[]> {
    const artifacts = await this.#repositories.artifacts.listOwned(ownerUserId);
    return Promise.all(artifacts.map((artifact) => this.#state(artifact)));
  }

  async get(ownerUserId: string, artifactId: string): Promise<ArtifactManagementState> {
    const artifact = await this.#repositories.artifacts.findOwned(ownerUserId, artifactId);
    if (!artifact) {
      throw new ArtifactManagementError("artifact_not_found");
    }
    return this.#state(artifact);
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
    return {
      id: artifact.id,
      name: artifact.name,
      uploadSessionId: uploadSession?.id ?? null,
      processingState: state,
      shareLink: this.#shareLink(shareLink),
      readyVersion: version ? { id: version.id, state: "ready" } : null,
      publication: publication
        ? { id: publication.id, versionId: publication.versionId, publishedAt: publication.createdAt.toISOString() }
        : null,
      failure:
        state === "failed" && uploadSession?.failureReasonCode && uploadSession.failureSummary
          ? {
              code: uploadSession.failureReasonCode,
              message: uploadSession.failureSummary,
              recoverable: uploadSession.retryable
            }
          : null,
      allowedActions: actions(state, uploadSession, publication)
    };
  }

  #shareLink(link: ShareLinkRecord): ArtifactManagementState["shareLink"] {
    return {
      url: new URL(`/a/${link.slug}/`, this.#viewerOrigin).toString(),
      state: link.status as ArtifactManagementState["shareLink"]["state"]
    };
  }
}
