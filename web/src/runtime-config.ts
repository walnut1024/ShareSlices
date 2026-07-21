export type WebRuntimeConfig = Readonly<{
  apiOrigin: string;
  viewerOrigin: string;
  galleryContentOrigin: string | null;
  galleryTurnstileSiteKey: string | null;
}>;

const emptyConfig: WebRuntimeConfig = Object.freeze({
  apiOrigin: "",
  viewerOrigin: "",
  galleryContentOrigin: null,
  galleryTurnstileSiteKey: null,
});
let runtimeConfig = emptyConfig;

function optionalUrl(value: unknown, field: string): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${field} must be a URL or null`);
  return new URL(value).origin;
}

function requiredUrl(value: unknown, field: string): string {
  const parsed = optionalUrl(value, field);
  if (!parsed) throw new Error(`${field} is required`);
  return parsed;
}

export function parseWebRuntimeConfig(value: unknown): WebRuntimeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Web runtime bootstrap must be an object");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "apiOrigin",
    "viewerOrigin",
    "galleryContentOrigin",
    "galleryTurnstileSiteKey",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`Unknown Web runtime bootstrap field: ${key}`);
  }
  const siteKey = record.galleryTurnstileSiteKey;
  if (siteKey !== null && siteKey !== "" && (typeof siteKey !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(siteKey))) {
    throw new Error("galleryTurnstileSiteKey is invalid");
  }
  return Object.freeze({
    apiOrigin: requiredUrl(record.apiOrigin, "apiOrigin"),
    viewerOrigin: requiredUrl(record.viewerOrigin, "viewerOrigin"),
    galleryContentOrigin: optionalUrl(record.galleryContentOrigin, "galleryContentOrigin"),
    galleryTurnstileSiteKey: typeof siteKey === "string" && siteKey !== "" ? siteKey : null,
  });
}

export async function initializeWebRuntimeConfig(
  fetcher: typeof fetch = fetch,
): Promise<WebRuntimeConfig> {
  const response = await fetcher("/runtime-config.json", {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Web runtime bootstrap returned HTTP ${response.status}`);
  runtimeConfig = parseWebRuntimeConfig(await response.json());
  return runtimeConfig;
}

export function getWebRuntimeConfig(): WebRuntimeConfig {
  return runtimeConfig;
}
