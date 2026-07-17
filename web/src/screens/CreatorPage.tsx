import { useEffect, useState } from "react";
import {
  GalleryApiError,
  type GalleryCreator,
  getGalleryCreator,
} from "../api/gallery";
import { GalleryCard } from "../components/GalleryCard";
import {
  PublicGalleryShell,
  UnsupportedGalleryDevice,
  useUnsupportedGalleryDevice,
} from "../components/PublicGalleryShell";
import { Alert, AlertTitle } from "../components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../components/ui/empty";
import { Spinner } from "../components/ui/spinner";
import { setDocumentMetadata } from "../document-metadata";

export function CreatorPage({ slug }: { slug: string }) {
  const unsupported = useUnsupportedGalleryDevice();
  const [creator, setCreator] = useState<GalleryCreator | null>(null);
  const [error, setError] = useState<GalleryApiError | null>(null);

  useEffect(() => {
    let active = true;
    getGalleryCreator(slug)
      .then((value) => {
        if (!active) return;
        setCreator(value);
        setDocumentMetadata({
          title: `${value.profile.displayName} · ShareSlices Gallery`,
          robots: "index,follow",
          canonicalPath: `/creators/${encodeURIComponent(value.profile.slug)}`,
        });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof GalleryApiError
            ? reason
            : new GalleryApiError(
                "Creator could not be loaded.",
                "gallery_unavailable",
                503,
              ),
        );
        setDocumentMetadata({
          title: "Gallery Creator unavailable · ShareSlices",
          robots: "noindex,nofollow",
        });
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (error)
    return (
      <PublicGalleryShell>
        <main className="mx-auto w-full max-w-[1920px] px-8 py-7">
          <Alert variant={error.status === 503 ? "destructive" : "default"}>
            <AlertTitle>
              {error.status === 503 ? "Gallery is paused." : "Creator not found."}
            </AlertTitle>
          </Alert>
        </main>
      </PublicGalleryShell>
    );
  if (unsupported) return <UnsupportedGalleryDevice />;

  return (
    <PublicGalleryShell>
      <main className="mx-auto w-full max-w-[1920px] px-8 py-7">
        {!creator ? (
          <div className="grid min-h-96 place-items-center">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Loading Creator…
            </span>
          </div>
        ) : (
          <>
            <header className="mb-5 flex items-center gap-4 border-b pb-5">
              <Avatar className="size-16">
                {creator.profile.avatarUrl ? (
                  <AvatarImage src={creator.profile.avatarUrl} alt="" />
                ) : null}
                <AvatarFallback className="text-lg">
                  {creator.profile.displayName.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Gallery Creator</p>
                <h1 className="truncate text-2xl font-semibold tracking-[-0.02em]">
                  {creator.profile.displayName}
                </h1>
                {creator.profile.biography ? (
                  <p className="mt-1 max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">
                    {creator.profile.biography}
                  </p>
                ) : null}
              </div>
            </header>
            <section>
              <div className="mb-[18px] border-b pb-3.5">
                <h2 className="text-sm font-medium">Shared Artifacts</h2>
              </div>
              {creator.listings.items.length === 0 ? (
                <Empty className="min-h-72 border">
                  <EmptyHeader>
                    <EmptyTitle>No shared Artifacts</EmptyTitle>
                    <EmptyDescription>
                      This Creator has no Artifacts available in Gallery.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="grid grid-cols-4 gap-4">
                  {creator.listings.items.map((item) => (
                    <GalleryCard key={item.slug} item={item} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </PublicGalleryShell>
  );
}
