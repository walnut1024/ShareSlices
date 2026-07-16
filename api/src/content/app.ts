import { Hono, type Context } from "hono";
import { galleryContentPolicy } from "./security-policy.js";
import { contentAccessLog } from "./logging.js";

export type PublicPlayerCredentialValidator = Readonly<{
  validate(credential: string): Promise<unknown | null>;
}>;
export type AdministratorReviewCredentialValidator = Readonly<{
  validate(credential: string): Promise<unknown | null>;
}>;
export type GalleryContentLookup = Readonly<{ resolve(binding: unknown, path: string): Promise<unknown> }>;
export type GalleryContentStorage = Readonly<{ stream(asset: unknown): Promise<Response> }>;

export type GalleryContentDependencies = Readonly<{
  publicPlayer?: PublicPlayerCredentialValidator;
  administratorReview?: AdministratorReviewCredentialValidator;
  lookup?: GalleryContentLookup;
  storage?: GalleryContentStorage;
}>;

const unavailable = (requestId: string): Response => Response.json(
  {error: {code: "gallery_content_unavailable", message: "Gallery content is unavailable.", requestId}},
  {status: 503, headers: {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Request-Id": requestId}}
);

export function buildGalleryContentApp(dependencies: GalleryContentDependencies = {}): Hono {
  const app = new Hono();
  const ready = Boolean(dependencies.publicPlayer && dependencies.administratorReview && dependencies.lookup && dependencies.storage);

  app.use("*", contentAccessLog);
  app.use("/gallery-content/*", galleryContentPolicy);

  app.get("/health", (c) => c.json({status: "ok", service: "shareslices-gallery-content"}));
  app.get("/ready", (c) => ready
    ? c.json({status: "ready"})
    : c.json({status: "not_ready", reason: "credential_paths_unavailable"}, 503));

  const serveBound = (kind: "public" | "review") => async (c: Context) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    if (!ready || !dependencies.lookup || !dependencies.storage) return unavailable(requestId);
    const validator = kind === "public" ? dependencies.publicPlayer : dependencies.administratorReview;
    const credential = c.req.param("credential") ?? "";
    const rawPath = c.req.param("path") || "";
    let path: string;
    try { path = normalizeAssetPath(rawPath); } catch { return c.json({error: {code: "not_found", message: "Not found.", requestId}}, 404); }
    const binding = await validator?.validate(credential);
    if (!binding) return c.json({error: {code: "not_found", message: "Not found.", requestId}}, 404);
    const asset = await dependencies.lookup.resolve(binding, path);
    if (!asset) return c.json({error: {code: "not_found", message: "Not found.", requestId}}, 404);
    return dependencies.storage.stream(asset);
  };
  app.get("/gallery-content/public/:credential/:path{.*}", serveBound("public"));
  app.get("/gallery-content/review/:credential/:path{.*}", serveBound("review"));
  app.get("/gallery-content/public/:credential/", serveBound("public"));
  app.get("/gallery-content/review/:credential/", serveBound("review"));
  app.all("/gallery-content/public/*", (c) => ready ? c.json({error: {code: "not_found", message: "Not found."}}, 404) : unavailable(c.req.header("x-request-id") ?? crypto.randomUUID()));
  app.all("/gallery-content/review/*", (c) => ready ? c.json({error: {code: "not_found", message: "Not found."}}, 404) : unavailable(c.req.header("x-request-id") ?? crypto.randomUUID()));
  app.all("*", (c) => c.json({error: {code: "not_found", message: "Not found."}}, 404));
  return app;
}

export function normalizeAssetPath(raw: string): string {
  if (raw === "") return "";
  const decoded = raw.split("/").map((part) => decodeURIComponent(part)).join("/");
  if (decoded.includes("\\") || decoded.startsWith("/") || decoded.split("/").some((part) => part === ".." || part === "." || part === "")) throw new Error("invalid_asset_path");
  return decoded;
}
