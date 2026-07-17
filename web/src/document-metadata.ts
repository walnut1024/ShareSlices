export type DocumentMetadata = {
  title: string;
  robots: "index,follow" | "noindex,nofollow";
  canonicalPath?: string;
};

export function setDocumentMetadata({
  title,
  robots,
  canonicalPath,
}: DocumentMetadata) {
  document.title = title;

  let robotsMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="robots"]',
  );
  if (!robotsMeta) {
    robotsMeta = document.createElement("meta");
    robotsMeta.name = "robots";
    document.head.append(robotsMeta);
  }
  robotsMeta.content = robots;

  const canonical = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (!canonicalPath) {
    canonical?.remove();
    return;
  }

  const canonicalLink = canonical ?? document.createElement("link");
  canonicalLink.rel = "canonical";
  canonicalLink.href = new URL(canonicalPath, window.location.origin).toString();
  if (!canonical) document.head.append(canonicalLink);
}
