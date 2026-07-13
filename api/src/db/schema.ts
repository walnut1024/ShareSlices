import { relations, sql } from "drizzle-orm";
import type { ValidationReport } from "../application/artifacts/repositories.js";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
  },
  (table) => [index("session_user_id_idx").on(table.userId)]
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    uniqueIndex("account_provider_account_idx").on(table.providerId, table.accountId)
  ]
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

export const deviceCode = pgTable(
  "device_code",
  {
    id: text("id").primaryKey(),
    deviceCode: text("device_code").notNull().unique(),
    userCode: text("user_code").notNull().unique(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    pollingInterval: integer("polling_interval"),
    clientId: text("client_id"),
    scope: text("scope")
  },
  (table) => [index("device_code_user_id_idx").on(table.userId)]
);

export const emailVerificationAttempt = pgTable(
  "email_verification_attempt",
  {
    id: text("id").primaryKey(),
    purpose: text("purpose").notNull(),
    email: text("email").notNull(),
    destinationHint: text("destination_hint").notNull(),
    synthetic: boolean("synthetic").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
  },
  (table) => [
    index("email_verification_attempt_email_purpose_idx").on(table.email, table.purpose, table.createdAt),
    uniqueIndex("email_verification_attempt_one_pending_idx")
      .on(table.email, table.purpose)
      .where(sql`${table.consumedAt} is null`)
  ]
);

export const passwordResetGrant = pgTable(
  "password_reset_grant",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => emailVerificationAttempt.id, { onDelete: "cascade" }),
    encryptedCode: text("encrypted_code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimToken: text("claim_token"),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
  },
  (table) => [uniqueIndex("password_reset_grant_attempt_idx").on(table.attemptId)]
);

export const authenticationEmailDelivery = pgTable(
  "authentication_email_delivery",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => emailVerificationAttempt.id, { onDelete: "cascade" }),
    emailHash: text("email_hash").notNull(),
    purpose: text("purpose").notNull(),
    sourceIpHash: text("source_ip_hash").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
    idempotencyKey: text("idempotency_key"),
    state: text("state").default("pending").notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").default(0).notNull(),
    providerMessageId: text("provider_message_id"),
    failureReasonCode: text("failure_reason_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("authentication_email_delivery_idempotency_idx")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("authentication_email_delivery_attempt_idx").on(table.attemptId, table.createdAt),
    index("authentication_email_delivery_email_idx").on(table.emailHash, table.purpose, table.createdAt),
    index("authentication_email_delivery_source_idx").on(table.sourceIpHash, table.createdAt),
    index("authentication_email_delivery_dispatch_idx").on(table.state, table.availableAt)
  ]
);

export const authenticationEmailCircuitBreaker = pgTable("authentication_email_circuit_breaker", {
  id: text("id").primaryKey(),
  state: text("state").default("closed").notNull(),
  reasonCode: text("reason_code"),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  resumeAt: timestamp("resume_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  artifacts: many(artifact),
  publications: many(artifactPublication),
  idempotencyRecords: many(artifactIdempotencyRecord)
}));

export type ArtifactFormatSnapshot = {
  extension: string;
  contentType: string;
  validationKind: string;
};

export const artifactUploadPolicy = pgTable(
  "artifact_upload_policy",
  {
    id: text("id").primaryKey(),
    revision: text("revision").notNull().unique(),
    active: boolean("active").default(false).notNull(),
    archiveSizeBytes: bigint("archive_size_bytes", { mode: "number" }).notNull(),
    expandedSizeBytes: bigint("expanded_size_bytes", { mode: "number" }).notNull(),
    fileCount: integer("file_count").notNull(),
    singleFileSizeBytes: bigint("single_file_size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("artifact_upload_policy_one_active_idx")
      .on(table.active)
      .where(sql`${table.active}`),
    check("artifact_upload_policy_archive_size_check", sql`${table.archiveSizeBytes} > 0`),
    check("artifact_upload_policy_expanded_size_check", sql`${table.expandedSizeBytes} > 0`),
    check("artifact_upload_policy_file_count_check", sql`${table.fileCount} > 0`),
    check("artifact_upload_policy_single_file_size_check", sql`${table.singleFileSizeBytes} > 0`)
  ]
);

export const artifactUploadPolicyFormat = pgTable(
  "artifact_upload_policy_format",
  {
    policyId: text("policy_id")
      .notNull()
      .references(() => artifactUploadPolicy.id, { onDelete: "cascade" }),
    extension: text("extension").notNull(),
    contentType: text("content_type").notNull(),
    validationKind: text("validation_kind").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.policyId, table.extension] }),
    check("artifact_upload_policy_format_extension_check", sql`${table.extension} ~ '^\\.[a-z0-9]+$'`)
  ]
);

export const artifact = pgTable(
  "artifact",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index("artifact_owner_user_id_idx").on(table.ownerUserId),
    check(
      "artifact_name_check",
      sql`${table.name} = trim(${table.name}) and length(${table.name}) between 1 and 120`
    )
  ]
);

export const artifactDeletionCleanup = pgTable(
  "artifact_deletion_cleanup",
  {
    artifactId: text("artifact_id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    objectKeys: jsonb("object_keys").$type<string[]>().notNull(),
    stagingPrefixes: jsonb("staging_prefixes").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
    lastErrorCode: text("last_error_code")
  },
  (table) => [
    index("artifact_deletion_cleanup_owner_user_id_idx").on(table.ownerUserId),
    index("artifact_deletion_cleanup_claim_idx").on(table.nextAttemptAt, table.createdAt, table.artifactId),
    check("artifact_deletion_cleanup_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check(
      "artifact_deletion_cleanup_lease_check",
      sql`(${table.leaseOwner} is null) = (${table.leaseExpiresAt} is null)`
    )
  ]
);

export const artifactShareLink = pgTable(
  "artifact_share_link",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifact.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    status: text("status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("artifact_share_link_one_active_idx")
      .on(table.artifactId)
      .where(sql`${table.status} = 'active'`),
    check("artifact_share_link_status_check", sql`${table.status} in ('active', 'retired', 'expired')`),
    check("artifact_share_link_retired_at_check", sql`${table.status} <> 'retired' or ${table.retiredAt} is not null`),
    check("artifact_share_link_expires_at_check", sql`${table.status} <> 'expired' or ${table.expiresAt} is not null`)
  ]
);

export const artifactUploadSession = pgTable(
  "artifact_upload_session",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifact.id, { onDelete: "cascade" }),
    policyRevision: text("policy_revision").notNull(),
    archiveSizeBytes: bigint("archive_size_bytes", { mode: "number" }).notNull(),
    expandedSizeBytes: bigint("expanded_size_bytes", { mode: "number" }).notNull(),
    fileCount: integer("file_count").notNull(),
    singleFileSizeBytes: bigint("single_file_size_bytes", { mode: "number" }).notNull(),
    formats: jsonb("formats").$type<ArtifactFormatSnapshot[]>().notNull(),
    rawObjectKey: text("raw_object_key").notNull(),
    rawSha256: text("raw_sha256").notNull(),
    rawSizeBytes: bigint("raw_size_bytes", { mode: "number" }).notNull(),
    requestedEntry: text("requested_entry"),
    state: text("state").default("accepted").notNull(),
    failureReasonCode: text("failure_reason_code"),
    failureSummary: text("failure_summary"),
    validationReport: jsonb("validation_report").$type<ValidationReport>(),
    retryable: boolean("retryable").default(false).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index("artifact_upload_session_artifact_id_idx").on(table.artifactId),
    uniqueIndex("artifact_upload_session_current_idx")
      .on(table.artifactId)
      .where(sql`${table.supersededAt} is null and ${table.state} <> 'committed'`),
    check("artifact_upload_session_archive_size_check", sql`${table.archiveSizeBytes} > 0`),
    check("artifact_upload_session_expanded_size_check", sql`${table.expandedSizeBytes} > 0`),
    check("artifact_upload_session_file_count_check", sql`${table.fileCount} > 0`),
    check("artifact_upload_session_single_file_size_check", sql`${table.singleFileSizeBytes} > 0`),
    check("artifact_upload_session_formats_check", sql`jsonb_typeof(${table.formats}) = 'array'`),
    check("artifact_upload_session_sha256_check", sql`${table.rawSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "artifact_upload_session_raw_size_check",
      sql`${table.rawSizeBytes} >= 0 and ${table.rawSizeBytes} <= ${table.archiveSizeBytes}`
    ),
    check(
      "artifact_upload_session_state_check",
      sql`${table.state} in ('accepted', 'processing', 'committed', 'failed')`
    ),
    check(
      "artifact_upload_session_failure_check",
      sql`${table.state} = 'failed' or (${table.failureReasonCode} is null and ${table.failureSummary} is null and not ${table.retryable})`
    ),
    check("artifact_upload_session_retryable_check", sql`not ${table.retryable} or ${table.state} = 'failed'`)
  ]
);

export const artifactProcessingJob = pgTable(
  "artifact_processing_job",
  {
    id: text("id").primaryKey(),
    uploadSessionId: text("upload_session_id")
      .notNull()
      .references(() => artifactUploadSession.id, { onDelete: "cascade" }),
    state: text("state").default("queued").notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").default(0).notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index("artifact_processing_job_claim_idx")
      .on(table.state, table.availableAt)
      .where(sql`${table.state} = 'queued'`),
    index("artifact_processing_job_upload_session_id_idx").on(table.uploadSessionId),
    check("artifact_processing_job_state_check", sql`${table.state} in ('queued', 'running', 'completed', 'failed')`),
    check("artifact_processing_job_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check("artifact_processing_job_max_attempts_check", sql`${table.maxAttempts} > 0`),
    check(
      "artifact_processing_job_lease_check",
      sql`(${table.state} = 'running') = (${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)`
    )
  ]
);

export const artifactProcessingAttempt = pgTable(
  "artifact_processing_attempt",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => artifactProcessingJob.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    state: text("state").default("running").notNull(),
    stagingPrefix: text("staging_prefix").notNull(),
    reasonCode: text("reason_code"),
    retryScheduledAt: timestamp("retry_scheduled_at", { withTimezone: true }),
    exception: jsonb("exception").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true })
  },
  (table) => [
    unique("artifact_processing_attempt_job_number_unique").on(table.jobId, table.attemptNumber),
    check("artifact_processing_attempt_number_check", sql`${table.attemptNumber} > 0`),
    check("artifact_processing_attempt_state_check", sql`${table.state} in ('running', 'succeeded', 'failed')`),
    check(
      "artifact_processing_attempt_finished_check",
      sql`(${table.state} = 'running') = (${table.finishedAt} is null)`
    )
  ]
);

export const artifactVersion = pgTable(
  "artifact_version",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifact.id, { onDelete: "cascade" }),
    uploadSessionId: text("upload_session_id")
      .notNull()
      .unique()
      .references(() => artifactUploadSession.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    state: text("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index("artifact_version_artifact_id_idx").on(table.artifactId),
    unique("artifact_version_artifact_number_unique").on(table.artifactId, table.versionNumber),
    unique("artifact_version_id_artifact_unique").on(table.id, table.artifactId),
    check("artifact_version_number_check", sql`${table.versionNumber} > 0`),
    check("artifact_version_state_check", sql`${table.state} in ('ready')`)
  ]
);

export const artifactAsset = pgTable(
  "artifact_asset",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => artifactVersion.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    objectKey: text("object_key").notNull().unique(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    sha256: text("sha256").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.path] }),
    check("artifact_asset_path_check", sql`${table.path} <> '' and ${table.path} !~ '(^/|(^|/)\\.\\.(/|$))'`),
    check("artifact_asset_size_check", sql`${table.sizeBytes} >= 0`),
    check("artifact_asset_sha256_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`)
  ]
);

export const artifactManifest = pgTable(
  "artifact_manifest",
  {
    versionId: text("version_id")
      .primaryKey()
      .references(() => artifactVersion.id, { onDelete: "cascade" }),
    entryPath: text("entry_path").default("index.html").notNull(),
    fileCount: integer("file_count").notNull(),
    totalSizeBytes: bigint("total_size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.versionId, table.entryPath],
      foreignColumns: [artifactAsset.versionId, artifactAsset.path],
      name: "artifact_manifest_entry_asset_fk"
    }),
    check(
      "artifact_manifest_entry_path_check",
      sql`${table.entryPath} <> '' and ${table.entryPath} !~ '(^/|(^|/)\\.\\.(/|$))'`
    ),
    check("artifact_manifest_file_count_check", sql`${table.fileCount} > 0`),
    check("artifact_manifest_total_size_check", sql`${table.totalSizeBytes} >= 0`)
  ]
);

export const artifactPublication = pgTable(
  "artifact_publication",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifact.id, { onDelete: "cascade" }),
    versionId: text("version_id").notNull(),
    publishedByUserId: text("published_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true })
  },
  (table) => [
    foreignKey({
      columns: [table.versionId, table.artifactId],
      foreignColumns: [artifactVersion.id, artifactVersion.artifactId],
      name: "artifact_publication_version_artifact_fk"
    }).onDelete("restrict"),
    uniqueIndex("artifact_publication_one_current_idx")
      .on(table.artifactId)
      .where(sql`${table.endedAt} is null`),
    index("artifact_publication_version_id_idx").on(table.versionId)
  ]
);

export const artifactIdempotencyRecord = pgTable(
  "artifact_idempotency_record",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    targetResourceId: text("target_resource_id"),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    state: text("state").default("pending").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    unique("artifact_idempotency_record_scope_unique")
      .on(table.ownerUserId, table.operation, table.targetResourceId, table.key)
      .nullsNotDistinct(),
    check(
      "artifact_idempotency_record_operation_check",
      sql`${table.operation} in ('create_artifact', 'replace_upload', 'retry_upload', 'upload_version', 'publish')`
    ),
    check("artifact_idempotency_record_hash_check", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
    check("artifact_idempotency_record_state_check", sql`${table.state} in ('pending', 'completed')`),
    check(
      "artifact_idempotency_record_completion_check",
      sql`(${table.state} = 'pending' and ${table.responseStatus} is null and ${table.responseBody} is null and ${table.completedAt} is null)
        or (${table.state} = 'completed' and ${table.responseStatus} is not null and ${table.responseBody} is not null and ${table.completedAt} is not null)`
    )
  ]
);

export const artifactUploadPolicyRelations = relations(artifactUploadPolicy, ({ many }) => ({
  formats: many(artifactUploadPolicyFormat)
}));

export const artifactUploadPolicyFormatRelations = relations(artifactUploadPolicyFormat, ({ one }) => ({
  policy: one(artifactUploadPolicy, {
    fields: [artifactUploadPolicyFormat.policyId],
    references: [artifactUploadPolicy.id]
  })
}));

export const artifactRelations = relations(artifact, ({ many, one }) => ({
  owner: one(user, { fields: [artifact.ownerUserId], references: [user.id] }),
  shareLinks: many(artifactShareLink),
  uploadSessions: many(artifactUploadSession),
  versions: many(artifactVersion),
  publications: many(artifactPublication)
}));

export const artifactShareLinkRelations = relations(artifactShareLink, ({ one }) => ({
  artifact: one(artifact, { fields: [artifactShareLink.artifactId], references: [artifact.id] })
}));

export const artifactUploadSessionRelations = relations(artifactUploadSession, ({ many, one }) => ({
  artifact: one(artifact, { fields: [artifactUploadSession.artifactId], references: [artifact.id] }),
  jobs: many(artifactProcessingJob),
  version: one(artifactVersion)
}));

export const artifactProcessingJobRelations = relations(artifactProcessingJob, ({ many, one }) => ({
  uploadSession: one(artifactUploadSession, {
    fields: [artifactProcessingJob.uploadSessionId],
    references: [artifactUploadSession.id]
  }),
  attempts: many(artifactProcessingAttempt)
}));

export const artifactProcessingAttemptRelations = relations(artifactProcessingAttempt, ({ one }) => ({
  job: one(artifactProcessingJob, {
    fields: [artifactProcessingAttempt.jobId],
    references: [artifactProcessingJob.id]
  })
}));

export const artifactVersionRelations = relations(artifactVersion, ({ many, one }) => ({
  artifact: one(artifact, { fields: [artifactVersion.artifactId], references: [artifact.id] }),
  uploadSession: one(artifactUploadSession, {
    fields: [artifactVersion.uploadSessionId],
    references: [artifactUploadSession.id]
  }),
  manifest: one(artifactManifest),
  assets: many(artifactAsset),
  publications: many(artifactPublication)
}));

export const artifactManifestRelations = relations(artifactManifest, ({ one }) => ({
  version: one(artifactVersion, { fields: [artifactManifest.versionId], references: [artifactVersion.id] })
}));

export const artifactAssetRelations = relations(artifactAsset, ({ one }) => ({
  version: one(artifactVersion, { fields: [artifactAsset.versionId], references: [artifactVersion.id] })
}));

export const artifactPublicationRelations = relations(artifactPublication, ({ one }) => ({
  artifact: one(artifact, { fields: [artifactPublication.artifactId], references: [artifact.id] }),
  version: one(artifactVersion, { fields: [artifactPublication.versionId], references: [artifactVersion.id] }),
  publishedBy: one(user, { fields: [artifactPublication.publishedByUserId], references: [user.id] })
}));

export const artifactIdempotencyRecordRelations = relations(artifactIdempotencyRecord, ({ one }) => ({
  owner: one(user, { fields: [artifactIdempotencyRecord.ownerUserId], references: [user.id] })
}));
