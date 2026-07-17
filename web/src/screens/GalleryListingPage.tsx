import { AlertTriangle, Copy, Download, Flag, UserRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  GalleryApiError,
  type GalleryListing,
  galleryDownloadUrl,
  getGalleryCopy,
  getGalleryListing,
  issueGalleryPlayer,
  startGalleryCopy,
  submitGalleryReport,
} from "../api/gallery";
import { GalleryArtifactPlayer } from "../components/GalleryArtifactPlayer";
import {
  PublicSiteShell,
  UnsupportedPublicDevice,
  usePublicSiteSession,
  useUnsupportedPublicDevice,
} from "../components/PublicSiteShell";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Field, FieldLabel } from "../components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Spinner } from "../components/ui/spinner";
import { Textarea } from "../components/ui/textarea";
import { documentMetadataController } from "../document-metadata";
import { destinations } from "../routing";

export function GalleryListingPage({ slug }: { slug: string }) {
  const unsupported = useUnsupportedPublicDevice();
  const { user, checking } = usePublicSiteSession();
  const [listing, setListing] = useState<GalleryListing | null>(null);
  const [contentUrl, setContentUrl] = useState<string | null>(null);
  const [error, setError] = useState<GalleryApiError | null>(null);
  const [copyState, setCopyState] = useState<
    "idle" | "working" | "ready" | "failed"
  >("idle");
  const [reportOpen, setReportOpen] = useState(false);
  const copyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    let active = true;
    getGalleryListing(slug)
      .then((result) => {
        if (!active) return;
        setListing(result);
        documentMetadataController.resolvePublic({
          kind: "listing",
          slug: result.slug,
          title: result.title,
          indexable: false,
        });
        return issueGalleryPlayer(slug);
      })
      .then((issued) => {
        if (active && issued) setContentUrl(issued.entryUrl);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(asGalleryError(reason));
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (error) return <GalleryListingState error={error} />;
  if (!listing)
    return (
      <PublicSiteShell>
        <main id="main-content" className="grid min-h-[70vh] place-items-center">
          <span className="flex items-center gap-2 text-sm">
            <Spinner />
            Loading Artifact…
          </span>
        </main>
      </PublicSiteShell>
    );
  if (unsupported) return <UnsupportedPublicDevice />;

  async function saveCopy() {
    if (!user) {
      window.location.assign(
        destinations.signIn(destinations.listing(slug)),
      );
      return;
    }
    setCopyState("working");
    try {
      const accepted = await startGalleryCopy(
        slug,
        listing!.title,
        copyKey.current,
      );
      const operationId = accepted.id;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const current = await getGalleryCopy(operationId);
        if (current.state === "ready") {
          setCopyState("ready");
          return;
        }
        if (current.state === "failed" || current.state === "cancelled") {
          setCopyState("failed");
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      setCopyState("failed");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <PublicSiteShell>
      <main id="main-content" className="mx-auto w-full max-w-[1200px] px-6 py-7">
        <a
          className="text-sm text-muted-foreground hover:text-foreground"
          href={destinations.browse()}
        >
          ← Back to Browse
        </a>
        <div className="mt-5 grid grid-cols-[minmax(0,1.55fr)_minmax(360px,0.65fr)] gap-8">
          <section>
            <Card className="overflow-hidden py-0">
              {contentUrl ? (
                <GalleryArtifactPlayer
                  className="aspect-video w-full"
                  contentUrl={contentUrl}
                />
              ) : (
                <CardContent className="grid aspect-video place-items-center p-0 text-sm text-muted-foreground">
                  <Spinner />
                  Preparing isolated player…
                </CardContent>
              )}
            </Card>
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle />
              Artifact content runs in an isolated, credential-free frame.
            </p>
          </section>
          <aside className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="flex flex-wrap gap-2">
              {listing.tags.map((tag) => (
                <Badge key={tag} variant="secondary" render={<a href={destinations.browse({ mode: "tag", query: tag })} />}>
                  {tag}
                </Badge>
              ))}
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.03em]">
              {listing.title}
            </h1>
            <a
              className="mt-5 flex items-center gap-2 text-sm font-medium"
              href={destinations.creator(listing.creator.slug)}
            >
              <UserRound />
              {listing.creator.displayName}
            </a>
            {listing.description ? (
              <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {listing.description}
              </p>
            ) : null}
            {listing.sourceAttribution ? (
              <p className="mt-5 border-l-2 pl-3 text-xs leading-5 text-muted-foreground">
                Based on{" "}
                {listing.sourceAttribution.originalCreator ? (
                  <a
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                    href={`/creators/${encodeURIComponent(listing.sourceAttribution.originalCreator.slug)}`}
                  >
                    {listing.sourceAttribution.originalCreator.displayName}
                  </a>
                ) : (
                  "Original Creator unavailable"
                )}
                .
              </p>
            ) : null}
            <div className="mt-8 grid gap-2">
              <Button
                onClick={saveCopy}
                disabled={checking || copyState === "working"}
              >
                {copyState === "working" ? (
                  <>
                    <Spinner />
                    Saving a copy…
                  </>
                ) : copyState === "ready" ? (
                  "Saved to your Artifacts"
                ) : (
                  <>
                    <Copy />
                    Save a copy
                  </>
                )}
              </Button>
              <Button
                className="h-11"
                variant="outline"
                render={<a href={galleryDownloadUrl(slug)} />}
              >
                <Download />
                Download ZIP
              </Button>
              <Button
                className="h-10"
                variant="ghost"
                onClick={() => setReportOpen(true)}
              >
                <Flag />
                Report
              </Button>
            </div>
            {copyState === "failed" ? (
              <p className="mt-3 text-sm text-destructive">
                The copy could not be completed. No partial Artifact was added.
              </p>
            ) : null}
          </aside>
        </div>
      </main>
      <ReportDialog
        open={reportOpen}
        slug={slug}
        signedIn={Boolean(user)}
        onOpenChange={setReportOpen}
      />
    </PublicSiteShell>
  );
}

function ReportDialog({
  open,
  slug,
  signedIn,
  onOpenChange,
}: {
  open: boolean;
  slug: string;
  signedIn: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [category, setCategory] = useState("abuse");
  const [details, setDetails] = useState("");
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const onToken = useCallback((value: string) => setToken(value), []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await submitGalleryReport(slug, {
        category,
        details,
        ...(signedIn ? {} : { challengeToken: token }),
      });
      setMessage("Report accepted for review.");
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Report could not be submitted.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Report this Artifact</DialogTitle>
            <DialogDescription>
              Reports are private. The Creator will never see your identity.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 grid gap-4">
            <Field>
              <FieldLabel>Concern</FieldLabel>
              <Select
                value={category}
                onValueChange={(value) => value && setCategory(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="malware">Malware or phishing</SelectItem>
                    <SelectItem value="abuse">
                      Abuse or illegal content
                    </SelectItem>
                    <SelectItem value="copyright">Copyright</SelectItem>
                    <SelectItem value="privacy">Privacy</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="report-detail">
                What should reviewers know?
              </FieldLabel>
              <Textarea
                id="report-detail"
                minLength={1}
                maxLength={4000}
                required
                value={details}
                onChange={(event) => setDetails(event.target.value)}
              />
            </Field>
            {signedIn ? null : <TurnstileWidget onToken={onToken} />}
            {message ? <p className="text-sm">{message}</p> : null}
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || (!signedIn && !token) || !details.trim()}
            >
              {pending ? (
                <>
                  <Spinner />
                  Submitting…
                </>
              ) : (
                "Submit report"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
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
function GalleryListingState({ error }: { error: GalleryApiError }) {
  const gone = error.status === 410;
  const unavailable = error.status === 503;
  return (
    <PublicSiteShell galleryAvailable={!unavailable}>
      <main id="main-content" className="mx-auto w-full max-w-[900px] px-6 py-20">
        <Alert variant={unavailable ? "destructive" : "default"}>
          <AlertTitle>
          {gone
            ? "Withdrawn"
            : unavailable
              ? "Temporarily unavailable"
              : "Not found"}
          </AlertTitle>
          <AlertDescription>
            <h1 className="mb-1 text-base font-semibold text-foreground">
              {gone
                ? "This Artifact was withdrawn."
                : unavailable
                  ? "Gallery is paused."
                  : "This Gallery Artifact does not exist."}
            </h1>
            {gone
              ? "Its Gallery URL has been permanently retired."
              : unavailable
                ? "Public access will return only after every safety dependency is ready."
                : "The address may be incorrect or the Artifact may not be public."}
          </AlertDescription>
        </Alert>
        <a
          className="mt-8 inline-block underline underline-offset-4"
          href={unavailable ? destinations.website() : destinations.browse()}
        >
          {unavailable ? "Back to Website" : "Browse Gallery"}
        </a>
      </main>
    </PublicSiteShell>
  );
}
