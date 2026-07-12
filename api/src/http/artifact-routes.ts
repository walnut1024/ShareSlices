import { Hono } from "hono";
import { z } from "zod";
import { auth } from "../auth/auth.js";
import {
  ArtifactManagementError,
  ArtifactManagementService
} from "../application/artifacts/artifact-management.js";
import { ArtifactIntakeError, ArtifactIntakeService } from "../application/artifacts/artifact-intake.js";
import { ArtifactRecoveryError, ArtifactRecoveryService } from "../application/artifacts/artifact-recovery.js";
import type { ArtifactRepositories } from "../application/artifacts/repositories.js";
import { createArtifactRepositories } from "../db/artifact-repositories.js";
import { env } from "../env.js";
import { createConfiguredObjectStorage } from "../storage/index.js";
import { errorJson, requestId } from "./http-error.js";
import { MultipartUploadError, parseArtifactMultipartUpload } from "./multipart-upload.js";

export type ArtifactRouteDependencies = {
  authApi: Pick<typeof auth.api, "getSession">;
  repositories: Pick<ArtifactRepositories, "uploadPolicies">;
  management: Pick<ArtifactManagementService, "list" | "get" | "rename" | "setShareExpiration" | "delete">;
  intake: Pick<ArtifactIntakeService, "create">;
  recovery: Pick<ArtifactRecoveryService, "retry" | "replace">;
};

const updateArtifactSchema = z.object({ name: z.string() }).strict();
const updateShareLinkSchema = z.object({ expiresAt: z.string().datetime({ offset: true }).nullable() }).strict();
const artifactListQuerySchema = z.object({
  publication: z.enum(["published", "unpublished"]).optional(),
  processing: z.enum(["accepted", "processing", "ready", "failed"]).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  pageToken: z.string().min(1).optional()
}).strict();

export function artifactRoutes(overrides: Partial<ArtifactRouteDependencies> = {}): Hono {
  const defaultRepositories = createArtifactRepositories();
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
      maxProcessingAttempts: env.WORKER_JOB_MAX_ATTEMPTS
    }),
    recovery: new ArtifactRecoveryService({
      repositories: defaultRepositories,
      storage: createConfiguredObjectStorage(),
      viewerOrigin: env.VIEWER_ORIGIN,
      maxProcessingAttempts: env.WORKER_JOB_MAX_ATTEMPTS
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
      return errorJson(c, 400, "invalid_request");
    }
    try {
      const page = await dependencies.management.list(ownerId, parsed.data);
      c.header("X-Request-Id", requestId(c));
      return c.json(page);
    } catch (error) {
      if (error instanceof ArtifactManagementError && error.code === "invalid_page_token") {
        return errorJson(c, 400, "invalid_request");
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
      return errorJson(c, 400, "invalid_request");
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
        return errorJson(c, 400, "invalid_request");
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
          : errorJson(c, 400, "invalid_request");
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

  app.post("/api/artifacts/:artifactId/upload-sessions", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) {
      return errorJson(c, 401, "unauthenticated");
    }
    const idempotencyKey = c.req.header("idempotency-key");
    if (!idempotencyKey) {
      return errorJson(c, 400, "invalid_request");
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
        return errorJson(c, 400, "invalid_request");
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
          : errorJson(c, 400, "invalid_request");
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
      return errorJson(c, 400, "invalid_request");
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
      return errorJson(c, 400, "invalid_request");
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

  app.patch("/api/artifacts/:artifactId/share-link", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) return errorJson(c, 401, "unauthenticated");
    const parsed = updateShareLinkSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorJson(c, 400, "invalid_request");
    try {
      const artifact = await dependencies.management.setShareExpiration(
        ownerId,
        c.req.param("artifactId"),
        parsed.data.expiresAt
      );
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
