export type AppRoute =
  | { kind: "website-home" }
  | { kind: "browse" }
  | { kind: "gallery-listing"; slug: string }
  | { kind: "creator"; slug: string }
  | { kind: "sign-in" }
  | { kind: "sign-up" }
  | { kind: "reset-password" }
  | { kind: "device-authorization" }
  | { kind: "console-artifacts" }
  | { kind: "console-artifact"; artifactId: string }
  | { kind: "console-preview"; artifactId: string }
  | { kind: "console-gallery-profile" }
  | { kind: "gallery-administration" }
  | { kind: "not-found" };

export type PublicRoute = Extract<
  AppRoute,
  { kind: "website-home" | "browse" | "gallery-listing" | "creator" }
>;

export type AccountRoute = Extract<
  AppRoute,
  { kind: "sign-in" | "sign-up" | "reset-password" }
>;

export type ConsoleRoute = Extract<
  AppRoute,
  {
    kind:
      | "console-artifacts"
      | "console-artifact"
      | "console-preview"
      | "console-gallery-profile";
  }
>;

export type ProtectedRoute = ConsoleRoute | Extract<AppRoute, { kind: "gallery-administration" }>;

export type BrowseQuery = {
  mode: "default" | "newest" | "featured" | "search" | "tag";
  query?: string;
  cursor?: string;
};

export function classifyRoute(pathname: string): AppRoute {
  if (pathname === "/") return { kind: "website-home" };
  if (pathname === "/browse") return { kind: "browse" };
  if (pathname === "/sign-in") return { kind: "sign-in" };
  if (pathname === "/sign-up") return { kind: "sign-up" };
  if (pathname === "/reset-password") return { kind: "reset-password" };
  if (pathname === "/device") return { kind: "device-authorization" };
  if (pathname === "/console") return { kind: "console-artifacts" };
  if (pathname === "/console/settings/gallery-profile")
    return { kind: "console-gallery-profile" };
  if (pathname === "/admin/gallery") return { kind: "gallery-administration" };

  const galleryListing = matchDecodedSegment(pathname, /^\/gallery\/([^/]+)$/);
  if (galleryListing) return { kind: "gallery-listing", slug: galleryListing };

  const creator = matchDecodedSegment(pathname, /^\/creators\/([^/]+)$/);
  if (creator) return { kind: "creator", slug: creator };

  const preview = matchDecodedSegment(
    pathname,
    /^\/console\/artifacts\/([^/]+)\/preview$/,
  );
  if (preview) return { kind: "console-preview", artifactId: preview };

  const artifact = matchDecodedSegment(
    pathname,
    /^\/console\/artifacts\/([^/]+)$/,
  );
  if (artifact) return { kind: "console-artifact", artifactId: artifact };

  return { kind: "not-found" };
}

export function isPublicRoute(route: AppRoute): route is PublicRoute {
  return (
    route.kind === "website-home" ||
    route.kind === "browse" ||
    route.kind === "gallery-listing" ||
    route.kind === "creator"
  );
}

export function isAccountRoute(route: AppRoute): route is AccountRoute {
  return (
    route.kind === "sign-in" ||
    route.kind === "sign-up" ||
    route.kind === "reset-password"
  );
}

export function isConsoleRoute(route: AppRoute): route is ConsoleRoute {
  return (
    route.kind === "console-artifacts" ||
    route.kind === "console-artifact" ||
    route.kind === "console-preview" ||
    route.kind === "console-gallery-profile"
  );
}

export function isProtectedRoute(route: AppRoute): route is ProtectedRoute {
  return isConsoleRoute(route) || route.kind === "gallery-administration";
}

export function parseBrowseQuery(search: string): BrowseQuery {
  const parameters = new URLSearchParams(search);
  const tag = singleNonEmpty(parameters, "tag");
  const view = singleNonEmpty(parameters, "view");
  const query = singleNonEmpty(parameters, "q");
  const cursor = singleNonEmpty(parameters, "cursor");
  const withCursor = cursor ? { cursor } : {};

  if (tag) return { mode: "tag", query: tag, ...withCursor };
  if (view === "featured" || view === "newest")
    return { mode: view, ...withCursor };
  if (query) return { mode: "search", query, ...withCursor };
  return { mode: "default", ...withCursor };
}

export function browseLocation(input: BrowseQuery = { mode: "default" }): string {
  const query = new URLSearchParams();
  if (input.mode === "tag" && input.query) query.set("tag", input.query);
  if (input.mode === "search" && input.query) query.set("q", input.query);
  if (input.mode === "featured" || input.mode === "newest")
    query.set("view", input.mode);
  if (input.cursor) query.set("cursor", input.cursor);
  const serialized = query.toString();
  return serialized ? `/browse?${serialized}` : "/browse";
}

export const destinations = {
  website: () => "/",
  browse: browseLocation,
  listing: (slug: string) => `/gallery/${encodeURIComponent(slug)}`,
  creator: (slug: string) => `/creators/${encodeURIComponent(slug)}`,
  signIn: (returnTo?: string) =>
    returnTo
      ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}`
      : "/sign-in",
  signUp: () => "/sign-up",
  resetPassword: () => "/reset-password",
  console: () => "/console",
  artifact: (artifactId: string, galleryManage = false) =>
    `/console/artifacts/${encodeURIComponent(artifactId)}${galleryManage ? "?gallery=manage" : ""}`,
  preview: (artifactId: string, versionId: string) =>
    `/console/artifacts/${encodeURIComponent(artifactId)}/preview?versionId=${encodeURIComponent(versionId)}`,
  galleryProfile: () => "/console/settings/gallery-profile",
  administration: () => "/admin/gallery",
};

export function validateReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;

  try {
    const base = new URL("https://shareslices.invalid");
    const destination = new URL(value, base);
    if (destination.origin !== base.origin || destination.hash) return null;
    const route = classifyRoute(destination.pathname);
    if (!isPublicRoute(route) && !isProtectedRoute(route)) return null;
    return canonicalLocationForRoute(route, destination.search);
  } catch {
    return null;
  }
}

export function resolveCanonicalLocation(value: string): string {
  const location = new URL(value, "https://shareslices.invalid");
  const legacy = resolveLegacyManagement(location);
  if (legacy) return legacy;

  if (location.pathname === "/") {
    const rootSelection = parseRootGallerySelection(location.search);
    if (rootSelection) return browseLocation(rootSelection);
  }

  return `${location.pathname}${location.search}${location.hash}`;
}

function canonicalLocationForRoute(route: AppRoute, search: string): string | null {
  const parameters = new URLSearchParams(search);
  switch (route.kind) {
    case "website-home":
      return parameters.size === 0 ? destinations.website() : null;
    case "browse":
      return hasOnlySingleKeys(parameters, ["q", "tag", "view", "cursor"])
        ? browseLocation(parseBrowseQuery(search))
        : null;
    case "gallery-listing":
      return parameters.size === 0 ? destinations.listing(route.slug) : null;
    case "creator":
      return parameters.size === 0 ? destinations.creator(route.slug) : null;
    case "console-artifacts":
      return parameters.size === 0 ? destinations.console() : null;
    case "console-artifact": {
      if (!hasOnlySingleKeys(parameters, ["gallery"])) return null;
      const gallery = singleNonEmpty(parameters, "gallery");
      if (parameters.size > 0 && gallery !== "manage") return null;
      return destinations.artifact(route.artifactId, gallery === "manage");
    }
    case "console-preview": {
      if (!hasOnlySingleKeys(parameters, ["versionId"])) return null;
      const versionId = singleNonEmpty(parameters, "versionId");
      return versionId ? destinations.preview(route.artifactId, versionId) : null;
    }
    case "console-gallery-profile":
      return parameters.size === 0 ? destinations.galleryProfile() : null;
    case "gallery-administration":
      return parameters.size === 0 ? destinations.administration() : null;
    default:
      return null;
  }
}

function resolveLegacyManagement(location: URL): string | null {
  if (location.pathname === "/artifacts" || location.pathname === "/artifacts/new")
    return destinations.console();
  if (location.pathname === "/settings/gallery-profile")
    return destinations.galleryProfile();

  const preview = matchDecodedSegment(
    location.pathname,
    /^\/artifacts\/([^/]+)\/preview$/,
  );
  if (preview) {
    const versionId = singleNonEmpty(location.searchParams, "versionId");
    return versionId
      ? destinations.preview(preview, versionId)
      : `/console/artifacts/${encodeURIComponent(preview)}/preview`;
  }

  const artifact = matchDecodedSegment(location.pathname, /^\/artifacts\/([^/]+)$/);
  if (artifact) {
    const gallery = singleNonEmpty(location.searchParams, "gallery");
    return destinations.artifact(artifact, gallery === "manage");
  }
  return null;
}

function parseRootGallerySelection(search: string): BrowseQuery | null {
  const parameters = new URLSearchParams(search);
  const tag = singleNonEmpty(parameters, "tag");
  const view = singleNonEmpty(parameters, "view");
  const query = singleNonEmpty(parameters, "q");
  if (tag) return { mode: "tag", query: tag };
  if (view === "featured" || view === "newest") return { mode: view };
  if (query) return { mode: "search", query };
  return null;
}

function hasOnlySingleKeys(parameters: URLSearchParams, allowed: string[]): boolean {
  for (const key of new Set(parameters.keys())) {
    if (!allowed.includes(key) || parameters.getAll(key).length !== 1) return false;
  }
  return true;
}

function singleNonEmpty(parameters: URLSearchParams, key: string): string | null {
  const values = parameters.getAll(key);
  if (values.length !== 1) return null;
  const value = values[0]?.trim();
  return value ? value : null;
}

function matchDecodedSegment(pathname: string, pattern: RegExp): string | null {
  const encoded = pathname.match(pattern)?.[1];
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}
