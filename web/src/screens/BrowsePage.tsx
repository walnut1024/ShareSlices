import { ChevronRight, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { type GalleryPageResult, GalleryApiError, listGallery } from "../api/gallery";
import { GalleryCard } from "../components/GalleryCard";
import { PublicSiteShell, UnsupportedPublicDevice, useUnsupportedPublicDevice } from "../components/PublicSiteShell";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { Spinner } from "../components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { documentMetadataController } from "../document-metadata";
import { browseLocation, parseBrowseQuery } from "../routing";

export function BrowsePage() {
  const unsupported = useUnsupportedPublicDevice();
  const browse = parseBrowseQuery(window.location.search);
  const [query, setQuery] = useState(browse.mode === "search" ? (browse.query ?? "") : "");
  const [page, setPage] = useState<GalleryPageResult | null>(null);
  const [error, setError] = useState<GalleryApiError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let active = true;
    setPage(null);
    setError(null);
    listGallery({ mode: browse.mode, ...(browse.query ? { query: browse.query } : {}), ...(browse.cursor ? { cursor: browse.cursor } : {}) })
      .then((result) => {
        if (!active) return;
        setPage(result);
        documentMetadataController.resolvePublic({ kind: "browse", indexable: true });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(asGalleryError(reason));
      });
    return () => { active = false; };
  }, [browse.mode, browse.query]);

  function search(event: React.FormEvent) {
    event.preventDefault();
    const value = query.trim();
    window.location.assign(value ? browseLocation({ mode: "search", query: value }) : browseLocation());
  }

  async function loadMore() {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await listGallery({ mode: browse.mode, ...(browse.query ? { query: browse.query } : {}), cursor: page.nextCursor });
      setPage({ items: [...page.items, ...next.items], nextCursor: next.nextCursor });
    } catch (reason) {
      setError(asGalleryError(reason));
    } finally {
      setLoadingMore(false);
    }
  }

  if (unsupported && page) return <UnsupportedPublicDevice />;

  const unavailable = error?.status === 503 && !page;

  return (
    <PublicSiteShell galleryAvailable={!unavailable}>
      <main id="main-content" className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[1200px] flex-col px-6 pb-16">
        <div className="-mx-6 border-b bg-muted/35 px-6 py-7">
          <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <a className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/">Home</a>
            <ChevronRight aria-hidden="true" className="size-3.5" />
            <span aria-current="page">Browse</span>
          </nav>
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Browse Artifacts</h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">Discover interactive work shared by the ShareSlices community.</p>
            </div>
            {!unavailable ? <form className="flex w-full max-w-md items-center gap-2 sm:w-auto" onSubmit={search} role="search">
              <InputGroup className="min-w-0 flex-1 sm:w-[320px]"><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon><InputGroupInput aria-label="Search Gallery" placeholder="Search Gallery…" value={query} onChange={(event) => setQuery(event.target.value)} /></InputGroup>
              <Button type="submit">Search</Button>
            </form> : null}
          </div>
        </div>
        {!unavailable ? <div className="mb-6 flex items-center justify-between gap-4 border-b py-5">
          <strong className="text-sm font-medium text-foreground">{collectionTitle(browse.mode, browse.query)}</strong>
          <ToggleGroup aria-label="Gallery collection" value={[browse.mode === "newest" || browse.mode === "featured" ? browse.mode : "default"]} onValueChange={(value) => {
              const next = value[0];
              window.location.assign(next === "newest" || next === "featured" ? browseLocation({ mode: next }) : browseLocation());
            }}>
            <ToggleGroupItem value="default">All</ToggleGroupItem><ToggleGroupItem value="newest">Newest</ToggleGroupItem><ToggleGroupItem value="featured">Featured</ToggleGroupItem>
          </ToggleGroup>
        </div> : null}
        {!page && !error ? (
          <div aria-label="Loading Gallery" className="grid grid-cols-4 gap-4 py-6">
            {Array.from({ length: 8 }, (_, index) => <div className="aspect-[10/9] animate-pulse rounded-2xl bg-muted" key={index} />)}
          </div>
        ) : error && !page ? <GalleryState error={error} /> : page?.items.length === 0 ? (
          <Empty className="min-h-80 border"><EmptyHeader><EmptyTitle>No Artifacts found</EmptyTitle><EmptyDescription>Try a broader search or browse the full Gallery.</EmptyDescription></EmptyHeader></Empty>
        ) : page ? <>
          <div className="grid grid-cols-4 gap-4">{page.items.map((item) => <GalleryCard key={item.slug} item={item} />)}</div>
          {error ? <div className="mt-6"><GalleryState error={error} /></div> : null}
          {page.nextCursor ? <div className="mt-8 flex justify-center"><Button variant="outline" disabled={loadingMore} onClick={loadMore}>{loadingMore ? <><Spinner data-icon="inline-start" /> Loading…</> : "Load more"}</Button></div> : null}
        </> : null}
      </main>
    </PublicSiteShell>
  );
}

function collectionTitle(mode: ReturnType<typeof parseBrowseQuery>["mode"], query?: string) {
  if (mode === "featured") return "Featured";
  if (mode === "newest") return "Newest";
  if (mode === "tag") return `Tag: ${query}`;
  if (mode === "search") return `Results for “${query}”`;
  return "All shared Artifacts";
}

function asGalleryError(reason: unknown) {
  return reason instanceof GalleryApiError ? reason : new GalleryApiError("Gallery could not be loaded.", "gallery_unavailable", 503);
}

function GalleryState({ error }: { error: GalleryApiError }) {
  return <Alert variant="destructive"><AlertTitle><h2>Gallery is temporarily unavailable.</h2></AlertTitle><AlertDescription>{error.status === 503 ? "Public browsing is paused until every safety service is ready. Your Artifacts are unchanged." : error.message}</AlertDescription></Alert>;
}
