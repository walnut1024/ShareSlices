import { destinations, type AppRoute } from "./routing";

type PublicResolution =
  | { kind: "website" }
  | { kind: "browse"; indexable: boolean }
  | { kind: "listing"; slug: string; title: string; indexable: boolean }
  | { kind: "creator"; slug: string; displayName: string; indexable: boolean };

type DocumentMetadata = {
  title: string;
  robots: "index,follow" | "noindex,nofollow";
  canonicalPath?: string | undefined;
};

export const documentMetadataController = {
  begin(route: AppRoute) {
    applyMetadata({
      title: conservativeTitle(route),
      robots: "noindex,nofollow",
    });
  },

  resolvePublic(resolution: PublicResolution) {
    if (resolution.kind === "website") {
      applyMetadata({
        title: "ShareSlices · Publish interactive Artifacts",
        robots: "index,follow",
        canonicalPath: destinations.website(),
      });
      return;
    }

    const robots = resolution.indexable ? "index,follow" : "noindex,nofollow";
    if (resolution.kind === "browse") {
      applyMetadata({
        title: "Browse · ShareSlices",
        robots,
        canonicalPath: resolution.indexable ? destinations.browse() : undefined,
      });
      return;
    }
    if (resolution.kind === "listing") {
      applyMetadata({
        title: `${resolution.title} · ShareSlices Gallery`,
        robots,
        canonicalPath: resolution.indexable
          ? destinations.listing(resolution.slug)
          : undefined,
      });
      return;
    }
    applyMetadata({
      title: `${resolution.displayName} · ShareSlices Gallery`,
      robots,
      canonicalPath: resolution.indexable
        ? destinations.creator(resolution.slug)
        : undefined,
    });
  },
};

function conservativeTitle(route: AppRoute): string {
  switch (route.kind) {
    case "website-home":
      return "ShareSlices";
    case "browse":
      return "Browse · ShareSlices";
    case "sign-in":
      return "Sign in · ShareSlices";
    case "sign-up":
      return "Sign up · ShareSlices";
    case "reset-password":
      return "Reset password · ShareSlices";
    case "gallery-listing":
      return "Gallery Artifact · ShareSlices";
    case "creator":
      return "Gallery Creator · ShareSlices";
    case "not-found":
      return "Page not found · ShareSlices";
    default:
      return "ShareSlices";
  }
}

function applyMetadata({ title, robots, canonicalPath }: DocumentMetadata) {
  document.title = title;

  let robotsMeta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!robotsMeta) {
    robotsMeta = document.createElement("meta");
    robotsMeta.name = "robots";
    document.head.append(robotsMeta);
  }
  robotsMeta.content = robots;

  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonicalPath) {
    canonical?.remove();
    return;
  }

  const canonicalLink = canonical ?? document.createElement("link");
  canonicalLink.rel = "canonical";
  canonicalLink.href = new URL(canonicalPath, window.location.origin).toString();
  if (!canonical) document.head.append(canonicalLink);
}
