import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type GalleryPageResult,
  GalleryApiError,
  listGallery,
} from "../api/gallery";
import { GalleryCard } from "../components/GalleryCard";
import {
  PublicGalleryShell,
  UnsupportedGalleryDevice,
  useUnsupportedGalleryDevice,
} from "../components/PublicGalleryShell";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../components/ui/input-group";
import { Spinner } from "../components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";

type Collection = "default" | "newest" | "featured" | "search" | "tag";

export function GalleryPage() {
  const unsupported = useUnsupportedGalleryDevice();
  const parameters = new URLSearchParams(window.location.search);
  const initialQuery = parameters.get("q") ?? "";
  const tag = parameters.get("tag") ?? undefined;
  const requested = parameters.get("view");
  const mode: Collection = tag
    ? "tag"
    : requested === "newest" || requested === "featured"
      ? requested
      : initialQuery
        ? "search"
        : "default";
  const [query, setQuery] = useState(initialQuery);
  const [page, setPage] = useState<GalleryPageResult | null>(null);
  const [error, setError] = useState<GalleryApiError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let active = true;
    setPage(null);
    setError(null);
    listGallery({ mode, query: tag ?? initialQuery })
      .then((result) => active && setPage(result))
      .catch((reason: unknown) => active && setError(asGalleryError(reason)));
    return () => {
      active = false;
    };
  }, [initialQuery, mode, tag]);

  function search(event: React.FormEvent) {
    event.preventDefault();
    const value = query.trim();
    window.location.assign(
      value ? `/gallery?q=${encodeURIComponent(value)}` : "/gallery",
    );
  }

  async function loadMore() {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await listGallery({
        mode,
        query: tag ?? initialQuery,
        cursor: page.nextCursor,
      });
      setPage({
        items: [...page.items, ...next.items],
        nextCursor: next.nextCursor,
      });
    } catch (reason) {
      setError(asGalleryError(reason));
    } finally {
      setLoadingMore(false);
    }
  }

  if (error)
    return (
      <PublicGalleryShell>
        <main className="mx-auto w-full max-w-[1920px] px-8 py-7">
          <GalleryState error={error} />
        </main>
      </PublicGalleryShell>
    );
  if (!page)
    return (
      <PublicGalleryShell>
        <main className="flex min-h-[70vh] items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Loading Gallery…
        </main>
      </PublicGalleryShell>
    );
  if (unsupported) return <UnsupportedGalleryDevice />;

  return (
    <PublicGalleryShell>
      <main className="mx-auto flex min-h-[calc(100vh-57px)] w-full max-w-[1920px] flex-col px-8 py-7">
        <div className="mb-5">
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">
            Gallery
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Browse Artifacts shared by the ShareSlices community.
          </p>
        </div>

        <div className="mb-[18px] flex items-center justify-between gap-4 border-b pb-3.5">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <strong className="font-medium text-foreground">
              {collectionTitle(mode, tag, initialQuery)}
            </strong>
          </div>
          <div className="flex items-center gap-2">
            <form className="flex items-center gap-2" onSubmit={search} role="search">
              <InputGroup className="w-[280px]">
                <InputGroupAddon>
                  <Search aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="Search Gallery"
                  placeholder="Search Gallery…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </InputGroup>
              <Button size="sm" type="submit">
                Search
              </Button>
            </form>
            <ToggleGroup
              aria-label="Gallery collection"
              value={[mode === "newest" || mode === "featured" ? mode : "default"]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "newest" || next === "featured")
                  window.location.assign(`/gallery?view=${next}`);
                else if (next === "default") window.location.assign("/gallery");
              }}
            >
              <ToggleGroupItem value="default">All</ToggleGroupItem>
              <ToggleGroupItem value="newest">Newest</ToggleGroupItem>
              <ToggleGroupItem value="featured">Featured</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        {page.items.length === 0 ? (
          <Empty className="min-h-80 border">
            <EmptyHeader>
              <EmptyTitle>No Artifacts found</EmptyTitle>
              <EmptyDescription>
                Try a broader search or browse the full Gallery.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-4">
              {page.items.map((item) => (
                <GalleryCard key={item.slug} item={item} />
              ))}
            </div>
            {page.nextCursor ? (
              <div className="mt-8 flex justify-center">
                <Button
                  variant="outline"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore ? (
                    <>
                      <Spinner data-icon="inline-start" />
                      Loading…
                    </>
                  ) : (
                    "Load more"
                  )}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </main>
    </PublicGalleryShell>
  );
}

function collectionTitle(mode: Collection, tag?: string, query?: string) {
  if (mode === "featured") return "Featured";
  if (mode === "newest") return "Newest";
  if (mode === "tag") return `Tag: ${tag}`;
  if (mode === "search") return `Results for “${query}”`;
  return "All shared Artifacts";
}

function asGalleryError(reason: unknown) {
  return reason instanceof GalleryApiError
    ? reason
    : new GalleryApiError(
        "Gallery could not be loaded.",
        "gallery_unavailable",
        503,
      );
}

function GalleryState({ error }: { error: GalleryApiError }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>
        <h2>Gallery is temporarily unavailable.</h2>
      </AlertTitle>
      <AlertDescription>
        {error.status === 503
          ? "Public browsing is paused until every safety service is ready. Your Artifacts are unchanged."
          : error.message}
      </AlertDescription>
    </Alert>
  );
}
