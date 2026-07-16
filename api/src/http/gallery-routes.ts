import { Hono } from "hono";
import { Readable } from "node:stream";
import { z } from "zod";
import { auth } from "../auth/auth.js";
import { galleryConfigurationFromEnv } from "../application/gallery/configuration.js";
import { GalleryContentCredentialService } from "../application/gallery/content-credentials.js";
import { GalleryCreatorProfileService } from "../application/gallery/creator-profile.js";
import {
  GalleryUnavailableError,
  PostgresGalleryRuntimeGate,
  type GalleryEligibility,
} from "../application/gallery/eligibility.js";
import {
  GalleryOwnerOperationError,
  GalleryOwnerOperations,
  type GalleryOwnerOutcome,
} from "../application/gallery/owner-operations.js";
import { GalleryPermissionGrantService } from "../application/gallery/permission-grant.js";
import { PublicGalleryService } from "../application/gallery/public-gallery.js";
import {
  GalleryDownloadError,
  GalleryDownloadService,
} from "../application/gallery/download.js";
import { GalleryDownloadArchiveService } from "../application/gallery/download-archive.js";
import {
  GalleryAvatarError,
  GalleryAvatarService,
} from "../application/gallery/avatar-media.js";
import {
  GalleryCopyError,
  GalleryCopyService,
} from "../application/gallery/copy.js";
import {
  TurnstileChallengeVerifier,
  type ChallengeVerifier,
} from "../application/gallery/challenge-verifier.js";
import {
  GalleryReportError,
  GalleryReportService,
  galleryReportCategories,
} from "../application/gallery/reports.js";
import {
  GalleryGovernanceError,
  GalleryGovernanceService,
  type GovernanceDecisionKind,
} from "../application/gallery/governance.js";
import { pool } from "../db/client.js";
import { env } from "../env.js";
import { createConfiguredObjectStorage } from "../storage/index.js";
import { requestId } from "./http-error.js";

const profile = z
  .object({
    displayName: z.string(),
    biography: z.string().nullable(),
    // Avatar uploads are promoted by server-side upload IDs. A share proposal
    // only confirms the current profile and must never accept an object key.
    avatar: z.null(),
    expectedRevision: z.number().int().positive().nullable(),
  })
  .strict();
const profileUpdate = z.object({
  displayName: z.string(),
  biography: z.string().nullable(),
  avatarUploadId: z.string().min(1).nullable().optional(),
}).strict();
const permission = z
  .object({
    grantVersion: z.string(),
    accepted: z.literal(true),
    permissions: z.array(z.string()).optional(),
    creatorLicense: z.string().optional(),
  })
  .strict();
const metadata = z
  .object({
    title: z.string(),
    description: z.string().nullable(),
    tags: z.array(z.string()),
  })
  .strict();
const proposal = z
  .object({
    versionId: z.string().min(1),
    profile,
    permission,
    metadata,
    expectedListingRevision: z.number().int().positive().optional(),
    confirmedReplacement: z.boolean().optional(),
  })
  .strict();

const galleryCursor = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => {
    try {
      const parsed = JSON.parse(
        Buffer.from(value, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      return (
        typeof parsed.primary === "string" &&
        typeof parsed.listingId === "string"
      );
    } catch {
      return false;
    }
  });
const galleryPageQuery = z.object({
  cursor: galleryCursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
const gallerySearchQuery = galleryPageQuery.extend({
  q: z.string().min(1).max(200),
});

export type GalleryRouteDependencies = {
  authApi: Pick<typeof auth.api, "getSession">;
  owner: GalleryOwnerOperations;
  profiles: GalleryCreatorProfileService;
  grants: GalleryPermissionGrantService;
  publicGallery: PublicGalleryService;
  downloadArchive: GalleryDownloadArchiveService;
  avatars: GalleryAvatarService;
  copy: GalleryCopyService;
  reports: GalleryReportService;
  governance: GalleryGovernanceService;
  credentials: GalleryContentCredentialService;
  gate: {
    requireEligible(): void | Promise<void>;
    current(): GalleryEligibility | Promise<GalleryEligibility>;
  };
};

export function galleryRoutes(
  overrides: Partial<GalleryRouteDependencies> = {},
): Hono {
  const configuration = galleryConfigurationFromEnv(env);
  const unavailableVerifier: ChallengeVerifier = {
    verify: async () => ({ success: false, reasonCode: "unavailable" }),
  };
  const storage = createConfiguredObjectStorage();
  const downloads = new GalleryDownloadService(
    pool,
    process.env.HOSTNAME ?? "api",
  );
  const dependencies: GalleryRouteDependencies = {
    authApi: auth.api,
    owner: new GalleryOwnerOperations(
      pool,
      {
        policyRevision: "gallery-safety/v1",
        maxFileCount: 1000,
        maxTotalBytes: 209715200,
        maxSingleFileBytes: 52428800,
        findingDecisions: {
          external_resource_dependency: "reject",
          external_programmatic_request: "reject",
          external_form_action: "reject",
          executable_dynamic_construction: "review",
        },
        evidenceDigestAlgorithm: "sha256",
        replayRequiresExactPolicyRevision: true,
      },
      env.ARTIFACT_RENDERER_REVISION,
    ),
    profiles: new GalleryCreatorProfileService(pool),
    grants: new GalleryPermissionGrantService(pool),
    publicGallery: new PublicGalleryService(pool),
    downloadArchive: new GalleryDownloadArchiveService(downloads, storage),
    avatars: new GalleryAvatarService(pool, storage),
    copy: new GalleryCopyService(pool, env.WORKER_JOB_MAX_ATTEMPTS),
    reports: new GalleryReportService(
      pool,
      env.GALLERY_TURNSTILE_SECRET
        ? new TurnstileChallengeVerifier(env.GALLERY_TURNSTILE_SECRET)
        : unavailableVerifier,
    ),
    governance: new GalleryGovernanceService(pool),
    credentials: new GalleryContentCredentialService(pool),
    gate: new PostgresGalleryRuntimeGate(pool, configuration),
    ...overrides,
  };
  const app = new Hono();
  const ownerProfile = (value: Awaited<ReturnType<GalleryCreatorProfileService["getOwn"]>>) => value ? ({
    id: value.id,
    opaqueSlug: value.opaqueSlug,
    displayName: value.displayName,
    biography: value.biography,
    avatar: value.avatar ? {url: `/gallery-media/avatar/${encodeURIComponent(value.opaqueSlug)}`, width: value.avatar.width, height: value.avatar.height} : null,
    revision: value.revision,
    visibility: value.retiredAt ? "retired" : value.publicAt ? "public" : "staged",
  }) : null;
  const ownerOperationResponse = async (
    ownerUserId: string,
    outcome: GalleryOwnerOutcome,
  ) => ({
    historicalOutcome: {
      operationId: outcome.operationId,
      operation: outcome.operation,
      acceptedAt: outcome.acceptedAt,
      status: outcome.status,
      committedListingRevision: outcome.listingRevision,
    },
    current: await dependencies.owner.view(ownerUserId, outcome.artifactId),
  });
  const userId = async (headers: Headers) =>
    (
      await dependencies.authApi.getSession({
        headers,
        query: { disableRefresh: true },
      })
    )?.user.id ?? null;
  const error = (
    c: Parameters<Hono["request"]>[0] extends never ? never : any,
    status: number,
    code: string,
  ) =>
    c.json(
      {
        error: {
          code,
          message: code.replaceAll("_", " "),
          requestId: requestId(c),
        },
      },
      status,
    );

  app.get("/api/gallery/permission-grant", async (c) => {
    if (!(await userId(c.req.raw.headers)))
      return error(c, 401, "unauthenticated");
    const grant = await dependencies.grants.current();
    return c.json({ grant });
  });
  app.get("/api/artifacts/:artifactId/gallery-listing", async (c) => {
    const owner = await userId(c.req.raw.headers);
    if (!owner) return error(c, 401, "unauthenticated");
    return c.json({
      listing: await dependencies.owner.view(owner, c.req.param("artifactId")),
    });
  });
  app.get("/api/gallery/profile", async (c) => {
    const owner = await userId(c.req.raw.headers);
    if (!owner) return error(c, 401, "unauthenticated");
    return c.json({ profile: ownerProfile(await dependencies.profiles.getOwn(owner)) });
  });
  app.post("/api/gallery/profile/avatar-uploads", async (c) => {
    const owner = await userId(c.req.raw.headers);
    if (!owner) return error(c, 401, "unauthenticated");
    const data = await c.req.formData().catch(() => null);
    const file = data?.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > 2_097_152)
      return error(c, 400, "invalid_gallery_avatar");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return c.json(
        await dependencies.avatars.stageUpload(owner, bytes, file.type),
        201,
      );
    } catch {
      return error(c, 400, "invalid_gallery_avatar");
    }
  });
  app.patch("/api/gallery/profile", async (c) => {
    const owner = await userId(c.req.raw.headers);
    if (!owner) return error(c, 401, "unauthenticated");
    const parsed = profileUpdate.safeParse(await c.req.json().catch(() => null));
    const match = /^"([1-9][0-9]*)"$/.exec(c.req.header("if-match") ?? "");
    if (!parsed.success || !match)
      return error(c, 400, "invalid_request");
    try {
      return c.json({
        profile: ownerProfile(await dependencies.profiles.updateFromUpload({
          userId: owner,
          displayName: parsed.data.displayName,
          biography: parsed.data.biography,
          expectedRevision: Number(match[1]),
          ...(parsed.data.avatarUploadId === undefined ? {} : {avatarUploadId: parsed.data.avatarUploadId}),
        })),
      });
    } catch (cause) {
      return error(
        c,
        409,
        (cause as { code?: string }).code ?? "profile_revision_conflict",
      );
    }
  });
  app.get("/gallery-media/avatar/:creatorSlug", async (c) => {
    try {
      await dependencies.gate.requireEligible();
      const avatar = await dependencies.avatars.readPublic(
        c.req.param("creatorSlug"),
      );
      return new Response(Readable.toWeb(Readable.from(avatar.body)) as ReadableStream<Uint8Array>, {headers: {
        "Content-Type": avatar.contentType, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"
      }});
    } catch (cause) {
      return error(c, cause instanceof GalleryUnavailableError ? 503 : 404, cause instanceof GalleryUnavailableError ? "gallery_unavailable" : cause instanceof GalleryAvatarError ? cause.code : "gallery_avatar_not_found");
    }
  });
  const mutate = (operation: "share" | "update") => async (c: any) => {
    const owner = await userId(c.req.raw.headers);
    if (!owner) return error(c, 401, "unauthenticated");
    const parsed = proposal.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return error(c, 400, "invalid_request");
    const key = c.req.header("idempotency-key");
    if (!key) return error(c, 400, "invalid_request");
    const data = parsed.data;
    const permissionInput = {
      grantVersion: data.permission.grantVersion,
      accepted: true as const,
      ...(data.permission.permissions
        ? { permissions: data.permission.permissions }
        : {}),
      ...(data.permission.creatorLicense
        ? { creatorLicense: data.permission.creatorLicense }
        : {}),
    };
    const input = {
      ownerUserId: owner,
      artifactId: c.req.param("artifactId"),
      versionId: data.versionId,
      idempotencyKey: key,
      profile: data.profile,
      permission: permissionInput,
      metadata: data.metadata,
      ...(data.confirmedReplacement === undefined
        ? {}
        : { confirmedReplacement: data.confirmedReplacement }),
    };
    try {
      await dependencies.gate.requireEligible();
      const outcome =
        operation === "share"
          ? await dependencies.owner.share(input)
          : await dependencies.owner.update({
              ...input,
              expectedListingRevision: data.expectedListingRevision!,
            });
      return c.json(await ownerOperationResponse(owner, outcome), 202);
    } catch (cause) {
      if (cause instanceof GalleryUnavailableError)
        return error(c, 503, "gallery_unavailable");
      const code =
        cause instanceof GalleryOwnerOperationError
          ? cause.code
          : "internal_error";
      return error(c, code === "artifact_not_found" ? 404 : 409, code);
    }
  };
  app.post("/api/artifacts/:artifactId/gallery-listing", mutate("share"));
  app.patch("/api/gallery-listings/:listingId", async (c) => {
    const owner = await userId(c.req.raw.headers);
    if (!owner) return error(c, 401, "unauthenticated");
    const parsed = proposal.safeParse(await c.req.json().catch(() => null));
    const match = /^"([1-9][0-9]*)"$/.exec(c.req.header("if-match") ?? "");
    const key = c.req.header("idempotency-key");
    if (!parsed.success || !match || !key)
      return error(c, 400, "invalid_request");
    const data = parsed.data;
    try {
      await dependencies.gate.requireEligible();
      const outcome = await dependencies.owner.updateListing({
        ownerUserId: owner,
        listingId: c.req.param("listingId"),
        versionId: data.versionId,
        idempotencyKey: key,
        profile: data.profile,
        permission: {
          grantVersion: data.permission.grantVersion,
          accepted: true,
        },
        metadata: data.metadata,
        expectedListingRevision: Number(match[1]),
      });
      return c.json(await ownerOperationResponse(owner, outcome), 202);
    } catch (cause) {
      const code =
        cause instanceof GalleryOwnerOperationError
          ? cause.code
          : "internal_error";
      return error(
        c,
        cause instanceof GalleryUnavailableError
          ? 503
          : code === "listing_not_found"
            ? 404
            : 409,
        cause instanceof GalleryUnavailableError
          ? "gallery_unavailable"
          : code,
      );
    }
  });
  app.delete("/api/gallery-listings/:listingId", async (c) => {
    const owner = await userId(c.req.raw.headers);
    if (!owner) return error(c, 401, "unauthenticated");
    const match = /^"([1-9][0-9]*)"$/.exec(c.req.header("if-match") ?? "");
    const key = c.req.header("idempotency-key");
    if (!match || !key) return error(c, 400, "invalid_request");
    try {
      const outcome = await dependencies.owner.withdraw({
          ownerUserId: owner,
          listingId: c.req.param("listingId"),
          expectedListingRevision: Number(match[1]),
          idempotencyKey: key,
        });
      return c.json(await ownerOperationResponse(owner, outcome));
    } catch (cause) {
      const code =
        cause instanceof GalleryOwnerOperationError
          ? cause.code
          : "internal_error";
      return error(
        c,
        code === "listing_not_found" ? 404 : 409,
        code,
      );
    }
  });
  app.post("/gallery/:gallerySlug/player-authorizations", async (c) => {
    try {
      await dependencies.gate.requireEligible();
      const issued = await dependencies.credentials.issuePublic(
        c.req.param("gallerySlug"),
      );
      if (!issued) return error(c, 404, "gallery_not_found");
      if (!configuration.contentOrigin)
        return error(c, 503, "gallery_unavailable");
      c.header("Cache-Control", "no-store");
      c.header("Referrer-Policy", "no-referrer");
      return c.json(
        {
          entryUrl: new URL(
            issued.entryUrlPath,
            configuration.contentOrigin,
          ).toString(),
          expiresAt: issued.expiresAt.toISOString(),
        },
        201,
      );
    } catch (cause) {
      return error(
        c,
        cause instanceof GalleryUnavailableError ? 503 : 500,
        cause instanceof GalleryUnavailableError
          ? "gallery_unavailable"
          : "internal_error",
      );
    }
  });
  const collection =
    (mode: "default" | "newest" | "featured" | "search" | "tag") =>
    async (c: any) => {
      try {
        await dependencies.gate.requireEligible();
        const parsed = (
          mode === "search" ? gallerySearchQuery : galleryPageQuery
        ).safeParse({
          cursor: c.req.query("cursor"),
          limit: c.req.query("limit"),
          ...(mode === "search" ? { q: c.req.query("q") } : {}),
        });
        if (!parsed.success) return error(c, 400, "invalid_request");
        return c.json(
          await dependencies.publicGallery.list({
            mode,
            ...(mode === "search"
              ? { query: (parsed.data as z.infer<typeof gallerySearchQuery>).q }
              : mode === "tag"
                ? { query: String(c.req.param("tag")) }
                : {}),
            ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
            limit: parsed.data.limit,
          }),
        );
      } catch (cause) {
        if (cause instanceof GalleryUnavailableError)
          return error(c, 503, "gallery_unavailable");
        throw cause;
      }
    };
  app.get("/gallery", collection("default"));
  app.get("/gallery/newest", collection("newest"));
  app.get("/gallery/featured", collection("featured"));
  app.get("/gallery/search", collection("search"));
  app.get("/gallery/tags/:tag", collection("tag"));
  app.get("/gallery/:gallerySlug", async (c) => {
    try {
      await dependencies.gate.requireEligible();
      const result = await dependencies.publicGallery.listing(
        c.req.param("gallerySlug"),
      );
      return result.kind === "eligible"
        ? c.json(result.listing)
        : error(
            c,
            result.kind === "gone" ? 410 : 404,
            result.kind === "gone" ? "gallery_gone" : "gallery_not_found",
          );
    } catch (cause) {
      if (cause instanceof GalleryUnavailableError)
        return error(c, 503, "gallery_unavailable");
      throw cause;
    }
  });
  app.get("/gallery/:gallerySlug/download", async (c) => {
    try {
      await dependencies.gate.requireEligible();
      const archive = await dependencies.downloadArchive.open(
        c.req.param("gallerySlug"),
        c.req.header("cf-connecting-ip") ??
          c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown",
      );
      return new Response(
        Readable.toWeb(archive.body) as ReadableStream<Uint8Array>,
        {
          headers: {
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${archive.fileName}"`,
          },
        },
      );
    } catch (cause) {
      if (cause instanceof GalleryDownloadError)
        return error(
          c,
          cause.code === "gone"
            ? 410
            : cause.code.includes("limited")
              ? 429
              : 404,
          cause.code,
        );
      return error(c, 503, "gallery_unavailable");
    }
  });
  app.post("/api/gallery/:gallerySlug/copy-operations", async (c) => {
    const copier = await userId(c.req.raw.headers);
    if (!copier) return error(c, 401, "unauthenticated");
    const key = c.req.header("idempotency-key");
    const body = (await c.req.json().catch(() => null)) as {
      title?: unknown;
    } | null;
    if (!key || typeof body?.title !== "string")
      return error(c, 400, "invalid_request");
    try {
      const slug = c.req.param("gallerySlug");
      const recovered = await dependencies.copy.recover(
        copier,
        slug,
        body.title,
        key,
      );
      if (recovered) return c.json(recovered, 202);
      await dependencies.gate.requireEligible();
      return c.json(
        await dependencies.copy.accept({
          copierUserId: copier,
          slug,
          title: body.title,
          idempotencyKey: key,
        }),
        202,
      );
    } catch (cause) {
      if (cause instanceof GalleryCopyError)
        return error(
          c,
          cause.code === "gone"
            ? 410
            : cause.code.includes("quota") ||
                cause.code === "idempotency_conflict"
              ? 409
              : cause.code === "rate_limited"
                ? 429
                : 404,
          cause.code,
        );
      return error(c, 503, "gallery_unavailable");
    }
  });
  app.get("/api/gallery-copy-operations/:operationId", async (c) => {
    const copier = await userId(c.req.raw.headers);
    if (!copier) return error(c, 401, "unauthenticated");
    const result = await dependencies.copy.get(
      copier,
      c.req.param("operationId"),
    );
    return result
      ? c.json(result)
      : error(c, 404, "gallery_operation_not_found");
  });
  app.post("/gallery/:gallerySlug/reports", async (c) => {
    const reporter = await userId(c.req.raw.headers);
    const body = (await c.req.json().catch(() => null)) as {
      category?: unknown;
      details?: unknown;
      challengeToken?: unknown;
    } | null;
    if (
      !body ||
      !galleryReportCategories.includes(body.category as never) ||
      typeof body.details !== "string" ||
      (!reporter && typeof body.challengeToken !== "string")
    )
      return error(c, 400, "invalid_request");
    try {
      await dependencies.gate.requireEligible();
      await dependencies.reports.submit({
        slug: c.req.param("gallerySlug"),
        category: body.category as (typeof galleryReportCategories)[number],
        detail: body.details,
        ...(typeof body.challengeToken === "string"
          ? { challengeToken: body.challengeToken }
          : {}),
        remoteIp:
          c.req.header("cf-connecting-ip") ??
          c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown",
        reporterUserId: reporter,
      });
      return c.json({ accepted: true }, 202);
    } catch (cause) {
      if (cause instanceof GalleryReportError)
        return error(
          c,
          cause.code === "rate_limited"
            ? 429
            : cause.code === "not_found"
              ? 404
              : cause.code === "challenge_unavailable"
                ? 503
                : 400,
          cause.code,
        );
      return error(c, 503, "gallery_unavailable");
    }
  });
  app.get("/gallery/creators/:creatorSlug", async (c) => {
    try {
      await dependencies.gate.requireEligible();
      const result = await dependencies.publicGallery.creator(
        c.req.param("creatorSlug"),
        c.req.query("cursor"),
        Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 30))),
      );
      return result
        ? c.json(result)
        : error(c, 404, "gallery_profile_not_found");
    } catch {
      return error(c, 503, "gallery_unavailable");
    }
  });
  app.post(
    "/api/admin/gallery/cases/:caseId/review-authorizations",
    async (c) => {
      const administrator = await userId(c.req.raw.headers);
      if (!administrator) return error(c, 401, "unauthenticated");
      try {
        if (!configuration.contentOrigin)
          return error(c, 503, "gallery_governance_unavailable");
        const issued = await dependencies.credentials.issueReview(
          administrator,
          { caseId: c.req.param("caseId") },
        );
        if (!issued) return error(c, 404, "gallery_case_not_found");
        c.header("Cache-Control", "no-store");
        c.header("Referrer-Policy", "no-referrer");
        return c.json(
          {
            state: "available",
            entryUrl: new URL(
              issued.entryUrlPath,
              configuration.contentOrigin,
            ).toString(),
            expiresAt: issued.expiresAt.toISOString(),
          },
          201,
        );
      } catch (cause) {
        const code = (cause as { code?: string }).code;
        if (code === "administrator_forbidden")
          return error(c, 403, code);
        return error(c, 503, "gallery_governance_unavailable");
      }
    },
  );
  app.get("/api/admin/gallery/cases", async (c) => {
    const administrator = await userId(c.req.raw.headers);
    if (!administrator) return error(c, 401, "unauthenticated");
    const queues = [
      "proposals",
      "reports",
      "appeals",
      "restrictions",
      "takedowns",
      "removals",
    ] as const;
    const queue = c.req.query("queue");
    const limit = Number(c.req.query("limit") ?? 50);
    if (
      !queues.includes(queue as (typeof queues)[number]) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      return error(c, 400, "invalid_request");
    try {
      return c.json(
        await dependencies.governance.queue(
          administrator,
          queue as (typeof queues)[number],
          c.req.query("cursor"),
          limit,
        ),
      );
    } catch (cause) {
      return error(
        c,
        403,
        (cause as { code?: string }).code ?? "administrator_forbidden",
      );
    }
  });
  app.get("/api/admin/gallery/cases/:caseId", async (c) => {
    const administrator = await userId(c.req.raw.headers);
    if (!administrator) return error(c, 401, "unauthenticated");
    try {
      return c.json(
        await dependencies.governance.getCase(
          administrator,
          c.req.param("caseId"),
        ),
      );
    } catch (cause) {
      const code =
        cause instanceof GalleryGovernanceError
          ? cause.code
          : ((cause as { code?: string }).code ??
            "gallery_governance_unavailable");
      return error(
        c,
        code === "case_not_found"
          ? 404
          : code === "administrator_forbidden"
            ? 403
            : 503,
        code,
      );
    }
  });
  app.post("/api/admin/gallery/cases/:caseId/decisions", async (c) => {
    const administrator = await userId(c.req.raw.headers);
    if (!administrator) return error(c, 401, "unauthenticated");
    const body = (await c.req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const key = c.req.header("idempotency-key");
    const kinds: GovernanceDecisionKind[] = [
      "approve",
      "reject",
      "dismiss",
      "remove",
      "restore",
      "restrict",
      "clear_restriction",
      "takedown",
      "clear_takedown",
      "uphold_appeal",
      "reverse_appeal",
    ];
    if (
      !key ||
      !body ||
      !kinds.includes(body.decision as GovernanceDecisionKind) ||
      typeof body.ruleCode !== "string" ||
      typeof body.rationale !== "string" ||
      !(
        body.expectedListingRevision === null ||
        (Number.isSafeInteger(body.expectedListingRevision) &&
          Number(body.expectedListingRevision) >= 1)
      )
    )
      return error(c, 400, "invalid_request");
    try {
      return c.json(
        await dependencies.governance.decide({
          actorUserId: administrator,
          caseId: c.req.param("caseId"),
          kind: body.decision as GovernanceDecisionKind,
          ruleCode: body.ruleCode,
          rationale: body.rationale,
          idempotencyKey: key,
          expectedListingRevision:
            body.expectedListingRevision === null
              ? null
              : Number(body.expectedListingRevision),
        }),
        201,
      );
    } catch (cause) {
      const code =
        cause instanceof GalleryGovernanceError
          ? cause.code
          : ((cause as { code?: string }).code ??
            "gallery_governance_unavailable");
      return error(
        c,
        code === "case_not_found"
          ? 404
          : code === "administrator_forbidden"
            ? 403
            : 409,
        code,
      );
    }
  });
  app.post("/api/gallery-decisions/:decisionId/appeals", async (c) => {
    const owner = await userId(c.req.raw.headers);
    if (!owner) return error(c, 401, "unauthenticated");
    const body = (await c.req.json().catch(() => null)) as {
      statement?: unknown;
    } | null;
    const key = c.req.header("idempotency-key");
    if (!key || typeof body?.statement !== "string")
      return error(c, 400, "invalid_request");
    try {
      return c.json(
        await dependencies.governance.appeal({
          userId: owner,
          decisionId: c.req.param("decisionId"),
          statement: body.statement,
          idempotencyKey: key,
        }),
        201,
      );
    } catch (cause) {
      const code =
        cause instanceof GalleryGovernanceError
          ? cause.code
          : "gallery_governance_unavailable";
      return error(
        c,
        code === "appeal_forbidden"
          ? 403
          : code === "appeal_unavailable"
            ? 404
            : 409,
        code,
      );
    }
  });
  app.get("/api/gallery/notifications", async (c) => {
    const owner = await userId(c.req.raw.headers);
    if (!owner) return error(c, 401, "unauthenticated");
    const limit = Number(c.req.query("limit") ?? 50);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      return error(c, 400, "invalid_request");
    try {
      return c.json(
        await dependencies.governance.notifications(
          owner,
          c.req.query("cursor"),
          limit,
        ),
      );
    } catch {
      return error(c, 503, "gallery_governance_unavailable");
    }
  });
  app.put("/api/admin/gallery/featured-positions/:position", async (c) => {
    const administrator = await userId(c.req.raw.headers);
    if (!administrator) return error(c, 401, "unauthenticated");
    const body = (await c.req.json().catch(() => null)) as {
      listingId?: unknown;
      expectedListingRevision?: unknown;
    } | null;
    const position = Number(c.req.param("position"));
    if (
      !Number.isInteger(position) ||
      position < 1 ||
      typeof body?.listingId !== "string" ||
      !Number.isSafeInteger(body.expectedListingRevision) ||
      Number(body.expectedListingRevision) < 1
    )
      return error(c, 400, "invalid_request");
    try {
      const featured = await dependencies.governance.setFeatured(
        administrator,
        body.listingId,
        position,
        Number(body.expectedListingRevision),
      );
      return c.json(featured);
    } catch (cause) {
      return error(
        c,
        403,
        (cause as { code?: string }).code ?? "administrator_forbidden",
      );
    }
  });
  app.delete("/api/admin/gallery/featured-positions/:position", async (c) => {
    const administrator = await userId(c.req.raw.headers);
    if (!administrator) return error(c, 401, "unauthenticated");
    const position = Number(c.req.param("position"));
    if (!Number.isInteger(position) || position < 1)
      return error(c, 400, "invalid_request");
    try {
      await dependencies.governance.removeFeatured(administrator, position);
      return c.body(null, 204);
    } catch (cause) {
      return error(
        c,
        403,
        (cause as { code?: string }).code ?? "administrator_forbidden",
      );
    }
  });
  return app;
}
