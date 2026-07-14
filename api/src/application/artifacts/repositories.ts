export type UploadPolicySnapshot = {
  revision: string;
  archiveSizeBytes: number;
  expandedSizeBytes: number;
  fileCount: number;
  singleFileSizeBytes: number;
  formats: Array<{
    extension: string;
    contentType: string;
    validationKind: string;
  }>;
};

export type ValidationDetails = {
  path?: string;
  paths?: string[];
  candidates?: string[];
  extension?: string;
  validationKind?: string;
  actualBytes?: number | string;
  limitBytes?: number | string;
  actualCount?: number | string;
  limitCount?: number | string;
  ignoredCount?: number | string;
  directory?: string;
  entryFile?: string;
};

export type ValidationNotice = {
  code: string;
  message: string;
  action: string | null;
  details: ValidationDetails;
};

export type ValidationReport = {
  primaryIssue: ValidationNotice | null;
  issues: ValidationNotice[];
  warnings: ValidationNotice[];
};

export type ArtifactRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ArtifactListCursor = { updatedAt: Date; artifactId: string };

export type ArtifactListQuery = {
  ownerUserId: string;
  publication?: "published" | "unpublished";
  processing?: "accepted" | "processing" | "ready" | "failed";
  cursor?: ArtifactListCursor;
  limit: number;
};

export type ShareLinkRecord = {
  id: string;
  artifactId: string;
  slug: string;
  status: string;
  retiredAt: Date | null;
};

export type ArtifactDeletionRecord = {
  objectKeys: string[];
  stagingPrefixes: string[];
};

export type ArtifactDeletionResult =
  | { kind: "cleanup"; record: ArtifactDeletionRecord }
  | { kind: "not_found" }
  | { kind: "invalid_state" };

export type UploadSessionRecord = {
  id: string;
  artifactId: string;
  state: string;
  retryable: boolean;
  rawObjectKey: string;
  failureReasonCode: string | null;
  failureSummary: string | null;
  validationReport: ValidationReport | null;
  supersededAt: Date | null;
};

export type UploadRawFingerprintCandidate = {
  keyRevision: string;
  fingerprint: string;
};

export type ProcessingJobRecord = {
  id: string;
  uploadSessionId: string;
  state: string;
  attemptCount: number;
  maxAttempts: number;
};

export type VersionRecord = {
  id: string;
  artifactId: string;
  uploadSessionId: string;
  versionNumber: number;
  state: string;
  thumbnailState?: "pending" | "ready" | "failed";
};

export type PublicationRecord = {
  id: string;
  artifactId: string;
  versionId: string;
  publishedByUserId: string;
  expirationKind: "permanent" | "duration" | "exact";
  durationSeconds: number | null;
  expiresAt: Date | null;
  createdAt: Date;
  endedAt: Date | null;
  endReason: "unpublished" | "superseded" | null;
};

export type IdempotencyRecord = {
  id: string;
  ownerUserId: string;
  operation: string;
  targetResourceId: string | null;
  key: string;
  requestHash: string | null;
  state: string;
  responseStatus: number | null;
  responseBody: Record<string, unknown> | null;
};

export type CommitAcceptedArtifactInput = {
  artifactId: string;
  ownerUserId: string;
  name: string;
  uploadSessionId: string;
  policy: UploadPolicySnapshot;
  rawObjectKey: string;
  rawFingerprintCandidates: UploadRawFingerprintCandidate[];
  processingRevision: string;
  contentIdentityRevision: string;
  rawSizeBytes: number;
  requestedEntry?: string | null;
  processingJobId: string;
  maxAttempts: number;
  idempotencyRecordId: string;
  requestHash: string;
  responseStatus: number;
  responseBody: Record<string, unknown>;
};

export type ClaimIdempotencyInput = {
  id: string;
  ownerUserId: string;
  operation: string;
  targetResourceId: string | null;
  key: string;
  provisionalRequestHash: string;
};

type CompleteIdempotencyInput = {
  idempotencyRecordId: string;
  requestHash: string;
  responseStatus: number;
  responseBody: Record<string, unknown>;
};

export type QueueManualRetryInput = CompleteIdempotencyInput & {
  uploadSessionId: string;
  processingJobId: string;
  maxAttempts: number;
};

export type CommitReplacementInput = CompleteIdempotencyInput & {
  artifactId: string;
  ownerUserId: string;
  previousUploadSessionId: string;
  uploadSessionId: string;
  policy: UploadPolicySnapshot;
  rawObjectKey: string;
  rawFingerprintCandidates: UploadRawFingerprintCandidate[];
  processingRevision: string;
  contentIdentityRevision: string;
  rawSizeBytes: number;
  requestedEntry?: string | null;
  processingJobId: string;
  maxAttempts: number;
};

export type CommitVersionUploadInput = Omit<CommitReplacementInput, "previousUploadSessionId">;

export interface UploadPolicyRepository {
  getActive(): Promise<UploadPolicySnapshot | null>;
}

export interface ArtifactRepository {
  listOwned(ownerUserId: string): Promise<ArtifactRecord[]>;
  listOwnedPage(input: ArtifactListQuery): Promise<ArtifactRecord[]>;
  findOwned(ownerUserId: string, artifactId: string): Promise<ArtifactRecord | null>;
  updateName(ownerUserId: string, artifactId: string, name: string): Promise<ArtifactRecord | null>;
  deleteOwned(ownerUserId: string, artifactId: string): Promise<ArtifactDeletionResult>;
  completeDeletion(ownerUserId: string, artifactId: string): Promise<void>;
  hasReadyVersion(artifactId: string): Promise<boolean>;
}

export interface ShareLinkRepository {
  findActiveByArtifact(artifactId: string): Promise<ShareLinkRecord | null>;
  findActiveByArtifacts(artifactIds: string[]): Promise<ShareLinkRecord[]>;
  findBySlug(slug: string): Promise<ShareLinkRecord | null>;
}

export interface UploadSessionRepository {
  findOwned(ownerUserId: string, uploadSessionId: string): Promise<UploadSessionRecord | null>;
  findCurrent(artifactId: string): Promise<UploadSessionRecord | null>;
  findCurrentByArtifacts(artifactIds: string[]): Promise<UploadSessionRecord[]>;
}

export interface ProcessingJobRepository {
  findByUploadSession(uploadSessionId: string): Promise<ProcessingJobRecord | null>;
}

export interface VersionRepository {
  findReadyOwned(ownerUserId: string, versionId: string): Promise<VersionRecord | null>;
  findReadyByArtifact(artifactId: string): Promise<VersionRecord | null>;
  findReadyByArtifacts(artifactIds: string[]): Promise<VersionRecord[]>;
  listReadyOwned(ownerUserId: string, artifactId: string): Promise<VersionRecord[]>;
}

export interface PublicationRepository {
  findLatest(artifactId: string): Promise<PublicationRecord | null>;
  findLatestByArtifacts(artifactIds: string[]): Promise<PublicationRecord[]>;
}

export interface IdempotencyRepository {
  find(
    ownerUserId: string,
    operation: string,
    targetResourceId: string | null,
    key: string
  ): Promise<IdempotencyRecord | null>;
  claimPending(input: ClaimIdempotencyInput): Promise<
    | { kind: "acquired"; record: IdempotencyRecord }
    | { kind: "existing"; record: IdempotencyRecord }
  >;
  releasePending(id: string): Promise<void>;
  reencryptPrevious(limit: number): Promise<number>;
}

export interface ArtifactIntakeRepository {
  commitAccepted(input: CommitAcceptedArtifactInput): Promise<void>;
}

export interface ArtifactRecoveryRepository {
  queueManualRetry(input: QueueManualRetryInput): Promise<void>;
  commitReplacement(input: CommitReplacementInput): Promise<void>;
  commitVersionUpload(input: CommitVersionUploadInput): Promise<void>;
}

export type ArtifactRepositories = {
  uploadPolicies: UploadPolicyRepository;
  artifacts: ArtifactRepository;
  shareLinks: ShareLinkRepository;
  uploadSessions: UploadSessionRepository;
  processingJobs: ProcessingJobRepository;
  versions: VersionRepository;
  publications: PublicationRepository;
  idempotency: IdempotencyRepository;
  intake: ArtifactIntakeRepository;
  recovery: ArtifactRecoveryRepository;
};
