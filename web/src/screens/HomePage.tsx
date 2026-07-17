import { ArrowRight, Search, ShieldCheck, Upload, Waypoints, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { GalleryApiError, listGallery, type GalleryCard as GalleryCardModel } from "../api/gallery";
import { GalleryCard } from "../components/GalleryCard";
import { PublicSiteShell, usePublicSiteSession } from "../components/PublicSiteShell";
import { Button, buttonVariants } from "../components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { Skeleton } from "../components/ui/skeleton";
import { documentMetadataController } from "../document-metadata";
import { destinations } from "../routing";

type DiscoveryState =
  | { kind: "loading" }
  | { kind: "ready"; items: GalleryCardModel[]; collection: "Featured" | "Newest" }
  | { kind: "unavailable" };

const publishingSteps: Array<{ icon: LucideIcon; title: string; description: string }> = [
  { icon: Upload, title: "Upload", description: "Package your HTML, CSS, JavaScript, images, fonts, and data in one Artifact." },
  { icon: Waypoints, title: "Publish", description: "Choose a ready Version and create one stable, time-bounded or permanent link." },
  { icon: ShieldCheck, title: "Share safely", description: "Public Gallery content runs across an explicit isolated-content boundary." },
];

export function HomePage() {
  const { user } = usePublicSiteSession();
  const [query, setQuery] = useState("");
  const [discovery, setDiscovery] = useState<DiscoveryState>({ kind: "loading" });

  useEffect(() => {
    documentMetadataController.resolvePublic({ kind: "website" });
    let active = true;
    listGallery({ mode: "featured", limit: 8 })
      .then(async (featured) => {
        if (!active) return;
        if (featured.items.length > 0) {
          setDiscovery({ kind: "ready", items: featured.items.slice(0, 8), collection: "Featured" });
          return;
        }
        const newest = await listGallery({ mode: "newest", limit: 8 });
        if (active) {
          setDiscovery({ kind: "ready", items: newest.items.slice(0, 8), collection: "Newest" });
        }
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof GalleryApiError && reason.status !== 503) {
          setDiscovery({ kind: "ready", items: [], collection: "Featured" });
          return;
        }
        setDiscovery({ kind: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, []);

  const ownershipLocation = user
    ? destinations.console()
    : destinations.signIn(destinations.console());
  const galleryAvailable = discovery.kind !== "unavailable";

  return (
    <PublicSiteShell galleryAvailable={galleryAvailable}>
      <main id="main-content">
        <section className="border-b bg-gradient-to-b from-muted/45 to-background">
          <div className="mx-auto max-w-[1200px] px-6 py-20 text-center">
            <p className="mx-auto inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-600" />
              Publish, browse, and share interactive work
            </p>
            <h1 className="mx-auto mt-5 max-w-3xl text-[56px] leading-[1.03] font-semibold tracking-[-0.045em] text-balance">
              The gallery for interactive Artifacts
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-[17px] leading-7 text-muted-foreground text-pretty">
              Open community-built prototypes, tools, visualizations, and decks in your browser—or publish your own with one stable link.
            </p>
            {galleryAvailable ? (
              <form action={destinations.browse()} className="mx-auto mt-8 flex max-w-[560px] items-center gap-2" method="get" role="search">
                <InputGroup className="h-12 flex-1 bg-background shadow-sm">
                  <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
                  <InputGroupInput aria-label="Search Gallery" name="q" placeholder="Search Artifacts, Creators, tags…" required value={query} onChange={(event) => setQuery(event.target.value)} />
                </InputGroup>
                <Button className="h-12 px-5" type="submit">Explore</Button>
              </form>
            ) : null}
            <div className="mt-5 flex items-center justify-center gap-3">
              <a className={buttonVariants({ variant: "outline" })} href={ownershipLocation}>
                Start publishing <ArrowRight data-icon="inline-end" />
              </a>
              {galleryAvailable ? (
                <a className={buttonVariants({ variant: "ghost" })} href={destinations.browse()}>
                  Browse all Artifacts
                </a>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-6 py-16" aria-labelledby="discover-heading">
          <div className="mb-7 flex items-end justify-between gap-8">
            <div>
              <h2 id="discover-heading" className="text-[26px] font-semibold tracking-[-0.03em]">
                {discovery.kind === "unavailable" ? "Community discovery is taking a pause." : discovery.kind === "ready" ? `${discovery.collection} Artifacts` : "Featured Artifacts"}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {discovery.kind === "unavailable" ? "The Website and your personal Artifacts remain available." : "Community work, ready to open in one click."}
              </p>
            </div>
            {galleryAvailable ? <a className="inline-flex items-center gap-1 text-sm font-medium hover:underline" href={destinations.browse()}>Browse all <ArrowRight className="size-4" /></a> : null}
          </div>

          {discovery.kind === "loading" ? (
            <div className="grid min-h-[430px] grid-cols-4 gap-4" aria-label="Loading Gallery discovery">
              {Array.from({ length: 8 }, (_, index) => <Skeleton className="aspect-[16/10] rounded-2xl" key={index} />)}
            </div>
          ) : discovery.kind === "unavailable" ? (
            <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed bg-muted/25 px-8 py-12 text-center">
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">Gallery will return when its safety services are ready. You can still sign in and manage your own Artifacts.</p>
            </div>
          ) : discovery.items.length === 0 ? (
            <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed px-8 py-12 text-sm text-muted-foreground">No public Artifacts are available yet.</div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {discovery.items.map((item) => <GalleryCard key={item.slug} item={item} />)}
            </div>
          )}
        </section>

        <section className="border-y bg-muted/30" aria-labelledby="publishing-heading">
          <div className="mx-auto max-w-[1200px] px-6 py-14">
            <div className="mb-8 text-center">
              <h2 id="publishing-heading" className="text-2xl font-semibold tracking-[-0.025em]">Publish in three steps</h2>
              <p className="mt-2 text-sm text-muted-foreground">Keep the complete interactive experience, not just a screenshot.</p>
            </div>
            <div className="grid grid-cols-3 divide-x rounded-2xl border bg-background shadow-sm">
            {publishingSteps.map(({ icon: Icon, title, description }) => (
              <div className="px-8 py-9" key={title}>
                <span className="grid size-9 place-items-center rounded-lg bg-muted"><Icon className="size-4" /></span>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
              </div>
            ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1200px] px-6 py-16">
          <div className="rounded-2xl bg-foreground px-10 py-12 text-center text-background">
            <h2 className="text-3xl font-semibold tracking-[-0.035em]">Have something worth sharing?</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-background/70">Publish an interactive Artifact with a stable link and keep control over its versions and visibility.</p>
            <div className="mt-7 flex justify-center gap-3">
              <a className={buttonVariants({ variant: "secondary" })} href={ownershipLocation}>Publish your Artifact <ArrowRight data-icon="inline-end" /></a>
              {galleryAvailable ? <a className={buttonVariants({ variant: "outline", className: "border-background/25 bg-transparent text-background hover:bg-background/10 hover:text-background" })} href={destinations.browse()}>Explore first</a> : null}
            </div>
          </div>
        </section>
      </main>
    </PublicSiteShell>
  );
}
