import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { z } from "zod";
import { auth } from "../auth/auth.js";
import {
  PublicationViewerError,
  PublicationViewerService,
  type ContentAsset,
  type ShareResolution,
  normalizeContentPath
} from "../application/artifacts/publication-viewer.js";
import { ArtifactManagementService } from "../application/artifacts/artifact-management.js";
import { createArtifactRepositories } from "../db/artifact-repositories.js";
import { createPublicationContentRepository } from "../db/publication-content-repository.js";
import { createArtifactThumbnailRepository, type ArtifactThumbnailRepository } from "../db/artifact-thumbnail-repository.js";
import { env } from "../env.js";
import { createConfiguredObjectStorage } from "../storage/index.js";
import type { ObjectBody, ObjectStorage } from "../storage/object-storage.js";
import { errorJson, requestId } from "./http-error.js";

export type PublicationViewerRouteDependencies = {
  authApi: Pick<typeof auth.api, "getSession">;
  service: Pick<PublicationViewerService, "preview" | "exportVersion" | "publish" | "updateExpiration" | "unpublish" | "resolveViewer">;
  management: Pick<ArtifactManagementService, "get">;
  storage: Pick<ObjectStorage, "readCommittedObject">;
  thumbnailRepository: Pick<ArtifactThumbnailRepository, "findOwned" | "consumeGrant" | "resolveSession" | "findVersionAsset">;
  managementOrigin: string;
};

const expirationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("permanent") }).strict(),
  z.object({ kind: z.literal("duration"), durationSeconds: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("exact"), expiresAt: z.string().datetime({ offset: true }) }).strict()
]);
const publishSchema = z.object({
  versionId: z.string().min(1).max(128),
  expiration: expirationSchema,
  link: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("reuse") }).strict(),
    z.object({ mode: z.literal("replace"), confirmRetire: z.literal(true) }).strict()
  ])
}).strict();
const updatePublicationSchema = z.object({
  expiration: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("permanent") }).strict(),
    z.object({ kind: z.literal("exact"), expiresAt: z.string().datetime({ offset: true }) }).strict()
  ])
}).strict();

function stream(body: ObjectBody): ReadableStream<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    }
  });
}

function assetResponse(asset: ContentAsset, body: ObjectBody, requestIdentifier?: string): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": asset.contentType
  });
  if (requestIdentifier) {
    headers.set("X-Request-Id", requestIdentifier);
  }
  return new Response(stream(body), { status: 200, headers });
}

function wildcardPath(c: Context, marker: string): string {
  const wildcard = c.req.param("*");
  if (wildcard) {
    return wildcard;
  }
  const path = new URL(c.req.url).pathname;
  const markerIndex = path.indexOf(marker);
  return markerIndex < 0 ? "" : path.slice(markerIndex + marker.length);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function statePage(kind: Exclude<ShareResolution["kind"], "published">, managementOrigin: string): Response {
  const state = {
    unpublished: { status: 200, title: "This artifact is not currently published", detail: "The owner is not sharing it right now." },
    expired: { status: 200, title: "This publication has expired", detail: "The owner may publish it again at this link." },
    retired: { status: 410, title: "This share link is no longer available", detail: "Ask the owner for a new share link." },
    unknown: { status: 404, title: "Share link not found", detail: "Check the link and try again." }
  }[kind];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${state.title}</title></head><body><main><h1>${state.title}</h1><p>${state.detail}</p><p><a href="${escapeHtml(managementOrigin)}">Go to ShareSlices</a></p></main></body></html>`;
  return new Response(html, {
    status: state.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}

function viewerPlayerPage(shareSlug: string): Response {
  const contentUrl = `/a/${encodeURIComponent(shareSlug)}/?contentMode=true`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ShareSlices Viewer</title>
  <style>
    html,body,#shareslices-player{width:100%;height:100%;margin:0;overflow:hidden;background:#09090b}
    #shareslices-player{position:relative}
    iframe{display:block;width:100%;height:100%;border:0;background:#09090b}
    button{position:fixed;top:12px;right:12px;z-index:2;display:grid;width:32px;height:32px;padding:0;place-items:center;border:1px solid rgba(255,255,255,.2);border-radius:8px;background:rgba(24,24,27,.86);color:#fafafa;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)}
    button:hover{background:rgba(39,39,42,.96)}
    button:focus-visible{outline:2px solid #fafafa;outline-offset:2px}
    svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    [hidden]{display:none!important}
    #shareslices-fullscreen-error{position:fixed;top:52px;right:12px;z-index:2;margin:0;padding:8px 10px;border-radius:8px;background:rgba(127,29,29,.94);color:#fef2f2;font:13px/1.4 system-ui,sans-serif}
  </style>
</head>
<body>
  <main id="shareslices-player">
    <iframe src="${escapeHtml(contentUrl)}" title="Artifact content" allow="fullscreen"></iframe>
    <button id="shareslices-fullscreen" type="button" aria-label="Enter full screen" title="Enter full screen">
      <svg data-enter-icon viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
      <svg data-exit-icon viewBox="0 0 24 24" aria-hidden="true" hidden><path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
    </button>
    <p id="shareslices-fullscreen-error" role="status" hidden>Full screen could not be opened.</p>
  </main>
  <script>
    (() => {
      const player = document.getElementById("shareslices-player");
      const button = document.getElementById("shareslices-fullscreen");
      const enterIcon = button.querySelector("[data-enter-icon]");
      const exitIcon = button.querySelector("[data-exit-icon]");
      const error = document.getElementById("shareslices-fullscreen-error");
      const sync = () => {
        const active = Boolean(document.fullscreenElement);
        const label = active ? "Exit full screen" : "Enter full screen";
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
        enterIcon.hidden = active;
        exitIcon.hidden = !active;
      };
      button.addEventListener("click", async () => {
        error.hidden = true;
        try {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
          } else if (player.requestFullscreen) {
            await player.requestFullscreen();
          } else {
            throw new Error("Fullscreen API unavailable");
          }
        } catch {
          error.hidden = false;
        }
      });
      document.addEventListener("fullscreenchange", sync);
      sync();
    })();
  </script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}

export function publicationViewerRoutes(
  overrides: Partial<PublicationViewerRouteDependencies> = {}
): Hono {
  const repository = createPublicationContentRepository();
  const dependencies: PublicationViewerRouteDependencies = {
    authApi: auth.api,
    service: new PublicationViewerService(repository, env.VIEWER_ORIGIN),
    management: new ArtifactManagementService({
      repositories: createArtifactRepositories(),
      viewerOrigin: env.VIEWER_ORIGIN,
      storage: createConfiguredObjectStorage()
    }),
    storage: createConfiguredObjectStorage(),
    thumbnailRepository: createArtifactThumbnailRepository(),
    managementOrigin: env.WEB_ORIGIN,
    ...overrides
  };
  const app = new Hono();

  async function ownerUserId(headers: Headers): Promise<string | null> {
    const session = await dependencies.authApi.getSession({
      headers,
      query: { disableRefresh: true }
    });
    return session?.user.id ?? null;
  }

  async function preview(c: Context, rawPath: string) {
    if (c.req.header("authorization")) {
      return errorJson(c, 401, "unauthenticated");
    }
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) {
      return errorJson(c, 401, "unauthenticated");
    }
    try {
      const asset = await dependencies.service.preview(ownerId, c.req.param("versionId") ?? "", rawPath);
      const object = await dependencies.storage.readCommittedObject(asset.objectKey);
      return assetResponse(asset, object.body, requestId(c));
    } catch (error) {
      if (error instanceof PublicationViewerError) {
        return errorJson(c, 404, error.code === "asset_not_found" ? "asset_not_found" : "version_not_found");
      }
      throw error;
    }
  }

  app.get("/api/versions/:versionId/content/", (c) => preview(c, ""));
  app.get("/api/versions/:versionId/content/*", (c) => preview(c, wildcardPath(c, "/content/")));

  app.get("/api/versions/:versionId/thumbnail", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) return errorJson(c, 401, "unauthenticated");
    const asset = await dependencies.thumbnailRepository.findOwned(ownerId, c.req.param("versionId"));
    if (!asset) return errorJson(c, 404, "thumbnail_not_found");
    const object = await dependencies.storage.readCommittedObject(asset.objectKey);
    const headers = new Headers({
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Type": asset.contentType,
      "X-Request-Id": requestId(c)
    });
    return new Response(stream(object.body), { status: 200, headers });
  });

  async function capture(c: Context, rawPath: string) {
    const versionId = c.req.param("versionId") ?? "";
    const path = rawPath === "" ? "" : normalizeContentPath(rawPath);
    if (path === null) return errorJson(c, 404, "asset_not_found");
    let sessionToken = getCookie(c, "shareslices_capture");
    if (rawPath === "") {
      const grant = c.req.query("grant");
      if (!grant) return errorJson(c, 404, "asset_not_found");
      const session = await dependencies.thumbnailRepository.consumeGrant(grant, versionId);
      if (!session) return errorJson(c, 404, "asset_not_found");
      sessionToken = session.token;
      setCookie(c, "shareslices_capture", session.token, {
        httpOnly: true,
        sameSite: "Strict",
        path: `/internal/thumbnail-captures/${encodeURIComponent(versionId)}/content/`,
        maxAge: 30
      });
    } else if (!sessionToken || !(await dependencies.thumbnailRepository.resolveSession(sessionToken, versionId))) {
      return errorJson(c, 404, "asset_not_found");
    }
    const asset = await dependencies.thumbnailRepository.findVersionAsset(versionId, path);
    if (!asset) return errorJson(c, 404, "asset_not_found");
    const object = await dependencies.storage.readCommittedObject(asset.objectKey);
    return c.body(stream(object.body), 200, {
      "Cache-Control": "no-store",
      "Content-Type": asset.contentType
    });
  }

  app.get("/internal/thumbnail-captures/:versionId/content/", (c) => capture(c, ""));
  app.get("/internal/thumbnail-captures/:versionId/content/*", (c) => capture(c, wildcardPath(c, "/content/")));

  app.get("/api/versions/:versionId/export", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) return errorJson(c, 401, "unauthenticated");
    try {
      const exported = await dependencies.service.exportVersion(
        ownerId,
        c.req.param("versionId"),
        c.req.query("artifactId")
      );
      const archive = new ZipArchive({ zlib: { level: 9 } });
      for (const asset of exported.assets) {
        const object = await dependencies.storage.readCommittedObject(asset.objectKey);
        archive.append(Readable.from(object.body), { name: asset.path });
      }
      void archive.finalize();
      const fileName = `${exported.artifactName.replaceAll(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "artifact"}.zip`;
      return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Type": "application/zip",
          "X-Request-Id": requestId(c)
        }
      });
    } catch (error) {
      if (error instanceof PublicationViewerError) return errorJson(c, 404, "version_not_found");
      throw error;
    }
  });

  app.post("/api/artifacts/:artifactId/publications", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) {
      return errorJson(c, 401, "unauthenticated");
    }
    const idempotencyKey = c.req.header("idempotency-key");
    if (!idempotencyKey) {
      return errorJson(c, 400, "invalid_request");
    }
    const parsed = publishSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return errorJson(c, 400, "invalid_request");
    }
    try {
      const result = await dependencies.service.publish({
        ownerUserId: ownerId,
        artifactId: c.req.param("artifactId"),
        versionId: parsed.data.versionId,
        idempotencyKey,
        expiration: parsed.data.expiration.kind === "exact"
          ? { kind: "exact", expiresAt: new Date(parsed.data.expiration.expiresAt) }
          : parsed.data.expiration,
        link: parsed.data.link.mode === "replace"
          ? { mode: "replace", confirmRetire: parsed.data.link.confirmRetire }
          : { mode: "reuse", confirmRetire: false }
      });
      c.header("X-Request-Id", requestId(c));
      return c.json(
        {
          publication: {
            id: result.publication.id,
            versionId: result.publication.versionId,
            publishedAt: result.publication.publishedAt.toISOString(),
            expirationKind: result.publication.expirationKind,
            durationSeconds: result.publication.durationSeconds,
            expiresAt: result.publication.expiresAt?.toISOString() ?? null,
            endedAt: null,
            endReason: null
          },
          shareLink: result.shareLink
        },
        201
      );
    } catch (error) {
      if (error instanceof PublicationViewerError) {
        if (error.code === "artifact_not_found") {
          return errorJson(c, 404, "artifact_not_found");
        }
        if (error.code === "operation_in_progress" || error.code === "idempotency_conflict") {
          return errorJson(c, 409, error.code);
        }
        if (error.code === "invalid_request" || error.code === "invalid_expiration") return errorJson(c, 400, error.code);
        return errorJson(c, 409, "version_not_ready");
      }
      throw error;
    }
  });

  app.patch("/api/artifacts/:artifactId/publications/:publicationId", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) return errorJson(c, 401, "unauthenticated");
    const parsed = updatePublicationSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorJson(c, 400, "invalid_request");
    try {
      await dependencies.service.updateExpiration(
        ownerId,
        c.req.param("artifactId"),
        c.req.param("publicationId"),
        parsed.data.expiration.kind === "exact"
          ? { kind: "exact", expiresAt: new Date(parsed.data.expiration.expiresAt) }
          : { kind: "permanent" }
      );
      const artifact = await dependencies.management.get(ownerId, c.req.param("artifactId"));
      c.header("X-Request-Id", requestId(c));
      return c.json({ artifact });
    } catch (error) {
      if (error instanceof PublicationViewerError) {
        if (error.code === "invalid_expiration") return errorJson(c, 400, "invalid_expiration");
        return errorJson(c, 404, "artifact_not_found");
      }
      throw error;
    }
  });

  app.delete("/api/artifacts/:artifactId/publications/:publicationId", async (c) => {
    const ownerId = await ownerUserId(c.req.raw.headers);
    if (!ownerId) {
      return errorJson(c, 401, "unauthenticated");
    }
    try {
      await dependencies.service.unpublish(
        ownerId,
        c.req.param("artifactId"),
        c.req.param("publicationId")
      );
      c.header("X-Request-Id", requestId(c));
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof PublicationViewerError) {
        return errorJson(c, 404, "artifact_not_found");
      }
      throw error;
    }
  });

  async function viewer(c: Context, rawPath: string, contentMode = false) {
    try {
      const result = await dependencies.service.resolveViewer(c.req.param("shareSlug") ?? "", rawPath);
      if (!("objectKey" in result)) {
        return statePage(result.kind, dependencies.managementOrigin);
      }
      if (rawPath === "" && !contentMode) {
        return viewerPlayerPage(c.req.param("shareSlug") ?? "");
      }
      const object = await dependencies.storage.readCommittedObject(result.objectKey);
      return assetResponse(result, object.body);
    } catch (error) {
      if (error instanceof PublicationViewerError) {
        return statePage("unknown", dependencies.managementOrigin);
      }
      throw error;
    }
  }

  app.get("/a/:shareSlug/", (c) =>
    viewer(
      c,
      "",
      c.req.query("contentMode") === "true" || c.req.header("Sec-Fetch-Dest") === "iframe"
    )
  );
  app.get("/a/:shareSlug/*", (c) =>
    viewer(c, wildcardPath(c, `/a/${c.req.param("shareSlug") ?? ""}/`))
  );

  return app;
}
