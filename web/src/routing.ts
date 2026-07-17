export type AppRoute =
  | { kind: "gallery-index" }
  | { kind: "gallery-listing"; slug: string }
  | { kind: "creator"; slug: string }
  | { kind: "sign-in" }
  | { kind: "sign-up" }
  | { kind: "reset-password" }
  | { kind: "device-authorization" }
  | { kind: "artifacts" }
  | { kind: "artifact"; artifactId: string }
  | { kind: "artifact-preview"; artifactId: string }
  | { kind: "gallery-administration" }
  | { kind: "gallery-profile" }
  | { kind: "not-found" };

export type PublicRoute = Extract<
  AppRoute,
  { kind: "gallery-index" | "gallery-listing" | "creator" }
>;

export type AccountRoute = Extract<
  AppRoute,
  { kind: "sign-in" | "sign-up" | "reset-password" }
>;

export type ManagementRoute = Extract<
  AppRoute,
  {
    kind:
      | "artifacts"
      | "artifact"
      | "artifact-preview"
      | "gallery-administration"
      | "gallery-profile";
  }
>;

export function classifyRoute(pathname: string): AppRoute {
  if (pathname === "/") return { kind: "gallery-index" };
  if (pathname === "/sign-in") return { kind: "sign-in" };
  if (pathname === "/sign-up") return { kind: "sign-up" };
  if (pathname === "/reset-password") return { kind: "reset-password" };
  if (pathname === "/device" || pathname.startsWith("/device/"))
    return { kind: "device-authorization" };
  if (pathname === "/artifacts" || pathname === "/artifacts/new")
    return { kind: "artifacts" };
  if (pathname === "/admin/gallery") return { kind: "gallery-administration" };
  if (pathname === "/settings/gallery-profile")
    return { kind: "gallery-profile" };

  const galleryListing = matchDecodedSegment(pathname, /^\/gallery\/([^/]+)$/);
  if (galleryListing) return { kind: "gallery-listing", slug: galleryListing };

  const creator = matchDecodedSegment(pathname, /^\/creators\/([^/]+)$/);
  if (creator) return { kind: "creator", slug: creator };

  const artifactPreview = matchDecodedSegment(
    pathname,
    /^\/artifacts\/([^/]+)\/preview$/,
  );
  if (artifactPreview)
    return { kind: "artifact-preview", artifactId: artifactPreview };

  const artifact = matchDecodedSegment(pathname, /^\/artifacts\/([^/]+)$/);
  if (artifact) return { kind: "artifact", artifactId: artifact };

  return { kind: "not-found" };
}

export function isPublicRoute(route: AppRoute): route is PublicRoute {
  return (
    route.kind === "gallery-index" ||
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

export function isManagementRoute(route: AppRoute): route is ManagementRoute {
  return (
    route.kind === "artifacts" ||
    route.kind === "artifact" ||
    route.kind === "artifact-preview" ||
    route.kind === "gallery-administration" ||
    route.kind === "gallery-profile"
  );
}

export function validateReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;

  try {
    const base = new URL("https://shareslices.invalid");
    const destination = new URL(value, base);
    if (destination.origin !== base.origin) return null;
    const route = classifyRoute(destination.pathname);
    if (!isPublicRoute(route) && !isManagementRoute(route)) return null;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return null;
  }
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
