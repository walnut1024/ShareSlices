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

export type ShareLinkRecord = {
  id: string;
  artifactId: string;
  slug: string;
  status: string;
  retiredAt: Date | null;
  expiresAt: Date | null;
};

export type ArtifactDeletionRecord = {
  objectKeys: string[];
  stagingPrefixes: string[];
};

export type UploadSessionRecord = {
  id: string;
  artifactId: string;
  state: string;
  retryable: boolean;
  rawObjectKey: string;
  rawSha256: string;
  failureReasonCode: string | null;
  failureSummary: string | null;
  validationReport: ValidationReport | null;
  supersededAt: Date | null;
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
  createdAt: Date;
};

export type PublicationRecord = {
  id: string;
  artifactId: string;
  versionId: string;
  publishedByUserId: string;
  createdAt: Date;
  endedAt: Date | null;
};

export type IdempotencyRecord = {
  id: string;
  ownerUserId: string;
  operation: string;
  targetResourceId: string | null;
  key: string;
  requestHash: string;
  state: string;
  responseStatus: number | null;
  responseBody: Record<string, unknown> | null;
};

export type CommitAcceptedArtifactInput = {
  artifactId: string;
  ownerUserId: string;
  name: string;
  shareLinkId: string;
  shareSlug: string;
  uploadSessionId: string;
  policy: UploadPolicySnapshot;
  rawObjectKey: string;
  rawSha256: string;
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
  previousUploadSessionId: string;
  uploadSessionId: string;
  policy: UploadPolicySnapshot;
  rawObjectKey: string;
  rawSha256: string;
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
  findOwned(ownerUserId: string, artifactId: string): Promise<ArtifactRecord | null>;
  updateName(ownerUserId: string, artifactId: string, name: string): Promise<ArtifactRecord | null>;
  deleteOwned(ownerUserId: string, artifactId: string): Promise<ArtifactDeletionRecord | null>;
  hasReadyVersion(artifactId: string): Promise<boolean>;
}

export interface ShareLinkRepository {
  findActiveByArtifact(artifactId: string): Promise<ShareLinkRecord | null>;
  findBySlug(slug: string): Promise<ShareLinkRecord | null>;
  updateExpirationOwned(ownerUserId: string, artifactId: string, expiresAt: Date | null): Promise<ShareLinkRecord | null>;
}

export interface UploadSessionRepository {
  findOwned(ownerUserId: string, uploadSessionId: string): Promise<UploadSessionRecord | null>;
  findCurrent(artifactId: string): Promise<UploadSessionRecord | null>;
}

export interface ProcessingJobRepository {
  findByUploadSession(uploadSessionId: string): Promise<ProcessingJobRecord | null>;
}

export interface VersionRepository {
  findReadyOwned(ownerUserId: string, versionId: string): Promise<VersionRecord | null>;
  findReadyByArtifact(artifactId: string): Promise<VersionRecord | null>;
  listReadyByArtifact(artifactId: string): Promise<VersionRecord[]>;
}

export interface PublicationRepository {
  findCurrent(artifactId: string): Promise<PublicationRecord | null>;
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
