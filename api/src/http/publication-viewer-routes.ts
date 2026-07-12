import { Hono, type Context } from "hono";
import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { z } from "zod";
import { auth } from "../auth/auth.js";
import {
  PublicationViewerError,
  PublicationViewerService,
  type ContentAsset,
  type ShareResolution
} from "../application/artifacts/publication-viewer.js";
import { createPublicationContentRepository } from "../db/publication-content-repository.js";
import { env } from "../env.js";
import { createConfiguredObjectStorage } from "../storage/index.js";
import type { ObjectBody, ObjectStorage } from "../storage/object-storage.js";
import { errorJson, requestId } from "./http-error.js";

export type PublicationViewerRouteDependencies = {
  authApi: Pick<typeof auth.api, "getSession">;
  service: Pick<PublicationViewerService, "preview" | "exportVersion" | "publish" | "unpublish" | "resolveViewer">;
  storage: Pick<ObjectStorage, "readCommittedObject">;
  managementOrigin: string;
};

const publishSchema = z.object({ versionId: z.string().min(1).max(128) }).strict();

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
    expired: { status: 410, title: "This share link has expired", detail: "Ask the owner for a new share link." },
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

export function publicationViewerRoutes(
  overrides: Partial<PublicationViewerRouteDependencies> = {}
): Hono {
  const repository = createPublicationContentRepository();
  const dependencies: PublicationViewerRouteDependencies = {
    authApi: auth.api,
    service: new PublicationViewerService(repository),
    storage: createConfiguredObjectStorage(),
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
      const publication = await dependencies.service.publish({
        ownerUserId: ownerId,
        artifactId: c.req.param("artifactId"),
        versionId: parsed.data.versionId,
        idempotencyKey
      });
      c.header("X-Request-Id", requestId(c));
      return c.json(
        {
          publication: {
            id: publication.id,
            versionId: publication.versionId,
            publishedAt: publication.publishedAt.toISOString()
          }
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
        return errorJson(c, 409, "version_not_ready");
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

  async function viewer(c: Context, rawPath: string) {
    try {
      const result = await dependencies.service.resolveViewer(c.req.param("shareSlug") ?? "", rawPath);
      if (!("objectKey" in result)) {
        return statePage(result.kind, dependencies.managementOrigin);
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

  app.get("/a/:shareSlug/", (c) => viewer(c, ""));
  app.get("/a/:shareSlug/*", (c) =>
    viewer(c, wildcardPath(c, `/a/${c.req.param("shareSlug") ?? ""}/`))
  );

  return app;
}
