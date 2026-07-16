import type { MiddlewareHandler } from "hono";

export const galleryContentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "sandbox allow-scripts"
].join("; ");

export const galleryPermissionsPolicy = [
  "camera=()", "microphone=()", "geolocation=()", "clipboard-read=()", "clipboard-write=()",
  "fullscreen=()", "payment=()", "usb=()", "serial=()", "hid=()", "interest-cohort=()"
].join(", ");

export const galleryContentPolicy: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Content-Security-Policy", galleryContentSecurityPolicy);
  c.header("Permissions-Policy", galleryPermissionsPolicy);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  c.header("Cross-Origin-Resource-Policy", "cross-origin");
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  c.header("Access-Control-Allow-Credentials", undefined);
  c.header("Set-Cookie", undefined);
};
