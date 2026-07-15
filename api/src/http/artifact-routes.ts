import { Hono } from "hono";
import { z } from "zod";
import { auth } from "../auth/auth.js";
import {
  ArtifactManagementError,
  ArtifactManagementService
} from "../application/artifacts/artifact-management.js";
import { ArtifactIntakeError, ArtifactIntakeService } from "../application/artifacts/artifact-intake.js";
import { ArtifactRecoveryError, ArtifactRecoveryService } from "../application/artifacts/artifact-recovery.js";
import { RawFingerprintCandidates } from "../application/artifacts/raw-fingerprint.js";
import type { ArtifactRepositories } from "../application/artifacts/repositories.js";
import { createArtifactRepositories } from "../db/artifact-repositories.js";
import { env } from "../env.js";
import { createConfiguredObjectStorage } from "../storage/index.js";
import { errorJson, type FieldError, requestId } from "./http-error.js";
import { MultipartUploadError, parseArtifactMultipartUpload } from "./multipart-upload.js";

export type ArtifactRouteDependencies = {
  authApi: Pick<typeof auth.api, "getSession">;
  repositories: Pick<ArtifactRepositories, "uploadPolicies">;
  management: Pick<ArtifactManagementService, "list" | "get" | "listReadyVersions" | "rename" | "delete">;
  intake: Pick<ArtifactIntakeService, "create">;
  recovery: Pick<ArtifactRecoveryService, "retry" | "replace">;
};

const updateArtifactSchema = z.object({ name: z.string() }).strict();
const artifactListQuerySchema = z.object({
  publication: z.enum(["published", "unpublished"]).optional(),
  processing: z.enum(["accepted", "processing", "ready", "failed"]).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  pageToken: z.string().min(1).optional()
}).strict();

const MAX_FIELD_ERRORS = 20;

function zodFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        path: [...issue.path, key].join(".") || key,
        code: "unrecognized_keys",
        message: "Invalid field."
      }));
    }
    return [{
      path: issue.path.join(".") || "request",
      code: issue.code,
      message: "Invalid field."
    }];
  }).slice(0, MAX_FIELD_ERRORS);
}

function requiredField(path: string): FieldError[] {
  return [{ path, code: "required", message: "Required field is missing." }];
}

function multipartField(error: MultipartUploadError): FieldError[] {
  const path = error.code.includes("file") || error.code === "archive_too_large"
    ? "file"
    : error.code.includes("entry")
      ? "entry"
      : error.code.includes("name")
        ? "name"
        : error.code.includes("content_type") || error.code.includes("boundary")
          ? "content-type"
          : "request";
  return [{ path, code: error.code, message: "Invalid field." }];
}

export function artifactRoutes(overrides: Partial<ArtifactRouteDependencies> = {}): Hono {
  const defaultRepositories = createArtifactRepositories();
  const rawFingerprints = new RawFingerprintCandidates({
    current: {
      revision: env.CONTENT_FINGERPRINT_KEY_CURRENT_REVISION,
      secret: env.CONTENT_FINGERPRINT_KEY_CURRENT
    },
    ...(env.CONTENT_FINGERPRINT_KEY_PREVIOUS && env.CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION
      ? {
          previous: {
            revision: env.CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION,
            secret: env.CONTENT_FINGERPRINT_KEY_PREVIOUS
          }
        }
      : {})
  });
  const dependencies: ArtifactRouteDependencies = {
    authApi: auth.api,
    repositories: { uploadPolicies: defaultRepositories.uploadPolicies },
    management: new ArtifactManagementService({
      repositories: defaultRepositories,
      viewerOrigin: env.VIEWER_ORIGIN,
      storage: createConfiguredObjectStorage()
    }),
    intake: new ArtifactIntakeService({
      repositories: defaultRepositories,
      storage: createConfiguredObjectStorage(),
      viewerOrigin: env.VIEWER_ORIGIN,
      maxProcessingAttempts: env.WORKER_JOB_MAX_ATTEMPTS,
      rawFingerprints,
      processingRevision: env.ARTIFACT_PROCESSING_REVISION,
      contentIdentityRevision: env.CONTENT_IDENTITY_REVISION
    }),
    recovery: new ArtifactRecoveryService({
      repositories: defaultRepositories,
      storage: createConfiguredObjectStorage(),
      viewerOrigin: env.VIEWER_ORIGIN,
      maxProcessingAttempts: env.WORKER_JOB_MAX_ATTEMPTS,
      rawFingerprints,
      processingRevision: env.ARTIFACT_PROCESSING_REVISION,
      contentIdentityRevision: env.CONTENT_IDENTITY_REVISION
    }),
    ...overrides
  };
  const app = new Hono();

  function archiveTooLarge(c: Parameters<typeof errorJson>[0], limitBytes: number) {
    return errorJson(c, 413, "archive_too_large", undefined, {
      action: "Reduce the ZIP below the upload limit and try again.",
      details: { limitBytes }
    });
  }

  async function ownerUserId(headers: Headers): Promise<string | null> {
    const session = await dependencies.authApi.getSession({
      headers,
      query: { disableRefresh: true }
    });
    return session?.user.id ?? null;
  }

  app.get("/api/artifact-upload-policies/current", async (c) => {
    if (!(await ownerUserId(c.req.raw.headers))) {
      return errorJson(c, 401, "unauthenticated");
    }

    const policy = await dependencies.repositories.uploadPolicies.getActive();
    if (!policy) {
      throw new Error("Active Artifact upload policy is missing.");
    }

    c.header("X-Request-Id", requestId(c));
    return c.json({
      policy: {
        revision: policy.revision,
        maxArchiveBytes: policy.archiveSizeBytes,
        maxExpandedBytes: policy.expandedSizeBytes,
        maxFileCount: policy.fileCount,
        maxFileBytes: policy.singleFileSizeBytes,
        enabledExtensions: policy.formats.map((format) => format.extension)
      }
    });
  });

  app.get("/api/artifacts", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) {
      return errorJson(c, 401, "unauthenticated");
    }
    const parsed = artifactListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return errorJson(c, 400, "invalid_request", zodFieldErrors(parsed.error));
    }
    try {
      const page = await dependencies.management.list(ownerId, parsed.data);
      c.header("X-Request-Id", requestId(c));
      return c.json(page);
    } catch (error) {
      if (error instanceof ArtifactManagementError && error.code === "invalid_page_token") {
        return errorJson(c, 400, "invalid_request", [{
          path: "pageToken",
          code: "invalid_page_token",
          message: "Invalid field."
        }]);
      }
      throw error;
    }
  });

  app.post("/api/artifacts", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) {
      return errorJson(c, 401, "unauthenticated");
    }
    const idempotencyKey = c.req.header("idempotency-key");
    if (!idempotencyKey) {
      return errorJson(c, 400, "invalid_request", requiredField("idempotency-key"));
    }
    const policy = await dependencies.repositories.uploadPolicies.getActive();
    if (!policy) {
      throw new Error("Active Artifact upload policy is missing.");
    }

    let upload: ReturnType<typeof parseArtifactMultipartUpload>;
    try {
      upload = parseArtifactMultipartUpload(c.req.raw, { maxArchiveBytes: policy.archiveSizeBytes });
    } catch (error) {
      if (error instanceof MultipartUploadError) {
        return errorJson(c, 400, "invalid_request", multipartField(error));
      }
      throw error;
    }

    try {
      const result = await dependencies.intake.create({
        ownerUserId: ownerId,
        idempotencyKey,
        name: upload.name,
        requestedEntry: upload.requestedEntry,
        body: upload.file,
        policy,
        completed: upload.completed
      });
      c.header("X-Request-Id", requestId(c));
      return c.json(result, 202);
    } catch (error) {
      upload.abort();
      if (error instanceof MultipartUploadError) {
        return error.code === "archive_too_large"
          ? archiveTooLarge(c, policy.archiveSizeBytes)
          : errorJson(c, 400, "invalid_request", multipartField(error));
      }
      if (error instanceof ArtifactIntakeError) {
        if (error.code === "archive_too_large") {
          return archiveTooLarge(c, policy.archiveSizeBytes);
        }
        if (error.code === "operation_in_progress" || error.code === "idempotency_conflict") {
          return errorJson(c, 409, error.code);
        }
        return errorJson(c, 400, "invalid_request");
      }
      throw error;
    }
  });

  app.get("/api/artifacts/:artifactId", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) {
      return errorJson(c, 401, "unauthenticated");
    }
    try {
      const artifact = await dependencies.management.get(ownerId, c.req.param("artifactId"));
      c.header("X-Request-Id", requestId(c));
      return c.json({ artifact });
    } catch (error) {
      if (error instanceof ArtifactManagementError && error.code === "artifact_not_found") {
        return errorJson(c, 404, "artifact_not_found");
      }
      throw error;
    }
  });

  app.get("/api/artifacts/:artifactId/versions", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) return errorJson(c, 401, "unauthenticated");
    try {
      const versions = await dependencies.management.listReadyVersions(ownerId, c.req.param("artifactId"));
      c.header("X-Request-Id", requestId(c));
      return c.json({ versions });
    } catch (error) {
      if (error instanceof ArtifactManagementError && error.code === "artifact_not_found") {
        return errorJson(c, 404, "artifact_not_found");
      }
      throw error;
    }
  });

  app.post("/api/artifacts/:artifactId/upload-sessions", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) {
      return errorJson(c, 401, "unauthenticated");
    }
    const idempotencyKey = c.req.header("idempotency-key");
    if (!idempotencyKey) {
      return errorJson(c, 400, "invalid_request", requiredField("idempotency-key"));
    }
    const policy = await dependencies.repositories.uploadPolicies.getActive();
    if (!policy) {
      throw new Error("Active Artifact upload policy is missing.");
    }

    let upload: ReturnType<typeof parseArtifactMultipartUpload>;
    try {
      upload = parseArtifactMultipartUpload(c.req.raw, {
        maxArchiveBytes: policy.archiveSizeBytes,
        requireName: false
      });
    } catch (error) {
      if (error instanceof MultipartUploadError) {
        return errorJson(c, 400, "invalid_request", multipartField(error));
      }
      throw error;
    }
    try {
      const result = await dependencies.recovery.replace({
        ownerUserId: ownerId,
        artifactId: c.req.param("artifactId"),
        idempotencyKey,
        body: upload.file,
        policy,
        requestedEntry: upload.requestedEntry,
        completed: upload.completed
      });
      c.header("X-Request-Id", requestId(c));
      return c.json(result, 202);
    } catch (error) {
      upload.abort();
      if (error instanceof MultipartUploadError) {
        return error.code === "archive_too_large"
          ? archiveTooLarge(c, policy.archiveSizeBytes)
          : errorJson(c, 400, "invalid_request", multipartField(error));
      }
      if (error instanceof ArtifactRecoveryError) {
        if (error.code === "artifact_not_found") {
          return errorJson(c, 404, "artifact_not_found");
        }
        if (error.code === "archive_too_large") {
          return archiveTooLarge(c, policy.archiveSizeBytes);
        }
        if (
          error.code === "operation_in_progress" ||
          error.code === "idempotency_conflict" ||
          error.code === "invalid_artifact_state"
        ) {
          return errorJson(c, 409, error.code);
        }
        return errorJson(c, 400, "invalid_request");
      }
      throw error;
    }
  });

  app.post("/api/upload-sessions/:uploadSessionAction", async (c) => {
    const action = c.req.param("uploadSessionAction");
    if (!action.endsWith(":retry")) {
      return c.notFound();
    }
    const uploadSessionId = action.slice(0, -":retry".length);
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) {
      return errorJson(c, 401, "unauthenticated");
    }
    const idempotencyKey = c.req.header("idempotency-key");
    if (!idempotencyKey) {
      return errorJson(c, 400, "invalid_request", requiredField("idempotency-key"));
    }
    try {
      const result = await dependencies.recovery.retry({ ownerUserId: ownerId, uploadSessionId, idempotencyKey });
      c.header("X-Request-Id", requestId(c));
      return c.json(result, 202);
    } catch (error) {
      if (error instanceof ArtifactRecoveryError) {
        if (error.code === "upload_session_not_found") {
          return errorJson(c, 404, "upload_session_not_found");
        }
        if (
          error.code === "operation_in_progress" ||
          error.code === "idempotency_conflict" ||
          error.code === "invalid_artifact_state"
        ) {
          return errorJson(c, 409, error.code);
        }
        return errorJson(c, 400, "invalid_request");
      }
      throw error;
    }
  });

  app.patch("/api/artifacts/:artifactId", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) {
      return errorJson(c, 401, "unauthenticated");
    }
    const parsed = updateArtifactSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return errorJson(c, 400, "invalid_request", zodFieldErrors(parsed.error));
    }
    try {
      const artifact = await dependencies.management.rename(ownerId, c.req.param("artifactId"), parsed.data.name);
      c.header("X-Request-Id", requestId(c));
      return c.json({ artifact });
    } catch (error) {
      if (error instanceof ArtifactManagementError) {
        return error.code === "artifact_not_found"
          ? errorJson(c, 404, "artifact_not_found")
          : errorJson(c, 400, "invalid_request");
      }
      throw error;
    }
  });

  app.delete("/api/artifacts/:artifactId", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) return errorJson(c, 401, "unauthenticated");
    try {
      await dependencies.management.delete(ownerId, c.req.param("artifactId"));
      c.header("X-Request-Id", requestId(c));
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof ArtifactManagementError) {
        if (error.code === "artifact_not_found") return errorJson(c, 404, "artifact_not_found");
        if (error.code === "invalid_artifact_state") return errorJson(c, 409, "invalid_artifact_state");
        return errorJson(c, 400, "invalid_request");
      }
      throw error;
    }
  });

  return app;
}
