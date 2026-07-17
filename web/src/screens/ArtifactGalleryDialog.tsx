import { ImagePlus, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type Artifact,
  type ReadyArtifactVersion,
  listReadyArtifactVersions,
} from "../api/artifacts";
import {
  GalleryApiError,
  type GalleryGrant,
  type GalleryProfile,
  type OwnerGalleryListing,
  getCurrentGalleryGrant,
  getOwnGalleryProfile,
  getOwnerGalleryListing,
  shareArtifactToGallery,
  updateArtifactGallery,
  withdrawArtifactFromGallery,
} from "../api/gallery";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { useGalleryShareFeedback } from "../components/GalleryShareFeedback";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Field, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

export function ArtifactGalleryDialog({
  artifact,
  creatorDisplayName,
  open,
  onOpenChange,
  onListingChange,
}: {
  artifact: Artifact;
  creatorDisplayName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onListingChange?: (listing: OwnerGalleryListing | null) => void;
}) {
  const [listing, setListing] = useState<OwnerGalleryListing | null>(null);
  const [profile, setProfile] = useState<GalleryProfile | null>(null);
  const [grant, setGrant] = useState<GalleryGrant | null>(null);
  const [versions, setVersions] = useState<ReadyArtifactVersion[]>([]);
  const [versionId, setVersionId] = useState(artifact.readyVersion?.id ?? "");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(creatorDisplayName);
  const [biography, setBiography] = useState("");
  const [title, setTitle] = useState(artifact.name);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("demo");
  const [accepted, setAccepted] = useState(false);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const operationKey = useRef(crypto.randomUUID());
  const registerAcceptedShare = useGalleryShareFeedback();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    setAccepted(false);
    setConfirmWithdraw(false);
    Promise.all([
      getOwnerGalleryListing(artifact.id),
      getOwnGalleryProfile(),
      getCurrentGalleryGrant(),
      listReadyArtifactVersions(artifact.id),
    ])
      .then(([ownerListing, ownerProfile, currentGrant, readyVersions]) => {
        if (!active) return;
        setListing(ownerListing);
        onListingChange?.(ownerListing);
        setProfile(ownerProfile);
        setGrant(currentGrant);
        setVersions(readyVersions);
        setVersionId(artifact.readyVersion?.id ?? readyVersions[0]?.id ?? "");
        setDisplayName(ownerProfile?.displayName ?? creatorDisplayName);
        setBiography(ownerProfile?.biography ?? "");
      })
      .catch(
        (reason: unknown) =>
          active &&
          setError(
            reason instanceof GalleryApiError &&
              reason.code === "no_current_gallery_grant"
              ? "Share to Gallery is unavailable because there are no current permission terms to accept."
              : reason instanceof Error
                ? reason.message
                : "Gallery settings could not be loaded.",
          ),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [artifact.id, creatorDisplayName, open]);

  const restricted = Boolean(artifact.publicSharingRestriction);
  const canUpdate = !restricted && listing?.lifecycle === "listed";
  const canFreshShare =
    !restricted &&
    (!listing ||
      listing.lifecycle === "withdrawn" ||
      (listing.lifecycle === "removed" &&
        [
          "initial_policy_rejection",
          "initial_governance_block",
          "administrator_removal",
        ].includes(listing.closureReason ?? "")));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!versionId || !grant || (canUpdate && !accepted)) return;
    setPending(true);
    setError(null);
    const input = {
      versionId,
      profile: {
        displayName: canUpdate
          ? displayName
          : (profile?.displayName ?? creatorDisplayName),
        biography: canUpdate
          ? biography.trim() || null
          : (profile?.biography ?? null),
        avatar: null as null,
        expectedRevision: profile?.revision ?? null,
      },
      permission: { grantVersion: grant.version, accepted: true as const },
      metadata: {
        title: canUpdate ? title : artifact.name,
        description: canUpdate ? description.trim() || null : null,
        tags: canUpdate
          ? tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          : [],
      },
      ...(listing?.closureReason === "administrator_removal"
        ? { confirmedReplacement: confirmReplacement }
        : {}),
    };
    try {
      if (canUpdate && listing)
        await updateArtifactGallery(
          listing.id,
          input,
          listing.listingRevision,
          operationKey.current,
        );
      else {
        const result = await shareArtifactToGallery(artifact.id, input, operationKey.current);
        registerAcceptedShare({id: artifact.id, name: artifact.name}, result.current);
        onListingChange?.(result.current);
        operationKey.current = crypto.randomUUID();
        onOpenChange(false);
        toast.success("Submitted to Gallery", {
          description: "We’ll let you know when it’s live.",
        });
        return;
      }
      const updated = await getOwnerGalleryListing(artifact.id);
      setListing(updated);
      onListingChange?.(updated);
      operationKey.current = crypto.randomUUID();
      setAccepted(false);
    } catch (reason) {
      setError(galleryMutationMessage(reason));
    } finally {
      setPending(false);
    }
  }

  async function withdraw() {
    if (!listing || !confirmWithdraw) return;
    setPending(true);
    setError(null);
    try {
      await withdrawArtifactFromGallery(
        listing.id,
        listing.listingRevision,
        operationKey.current,
      );
      const updated = await getOwnerGalleryListing(artifact.id);
      setListing(updated);
      onListingChange?.(updated);
      operationKey.current = crypto.randomUUID();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Gallery sharing could not be withdrawn.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[88vh] overflow-y-auto",
          canFreshShare && !canUpdate ? "sm:max-w-lg" : "sm:max-w-2xl",
        )}
      >
        <DialogHeader>
          <DialogTitle>
            {canUpdate ||
            listing?.lifecycle === "pending" ||
            (listing?.lifecycle === "removed" && !canFreshShare)
              ? "Manage Gallery"
              : `Share “${artifact.name}” to Gallery?`}
          </DialogTitle>
          <DialogDescription>
            {canFreshShare && !canUpdate
              ? "Anyone can view, download, and save a copy of this Artifact in Gallery. Your Share link won’t change."
              : "Gallery is a public community collection. Share with link remains a separate channel."}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex min-h-48 items-center justify-center gap-2">
            <Spinner />
            Loading Gallery settings…
          </div>
        ) : (
          <form className="mt-3 grid gap-5" onSubmit={submit}>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {restricted ? (
              <Alert>
                <TriangleAlert />
                <AlertTitle>Restricted</AlertTitle>
                <AlertDescription>
                  The underlying Gallery state is unchanged. Public-expanding changes are unavailable, but you can review this listing or withdraw it.
                </AlertDescription>
              </Alert>
            ) : null}
            {!grant ? (
              <Alert>
                <TriangleAlert />
                <AlertTitle>Share to Gallery is unavailable</AlertTitle>
                <AlertDescription>
                  There are no current Gallery permission terms to accept.
                  Existing listing state and past permission evidence remain
                  unchanged.
                </AlertDescription>
              </Alert>
            ) : null}
            {listing ? (
              <Alert>
                <AlertTitle className="capitalize">
                  {listing.lifecycle} · {listing.reviewState}
                </AlertTitle>
                <AlertDescription>
                  {listing.proposalId
                    ? `Proposal ${listing.proposalState ?? "pending"}. The current approved revision remains unchanged until promotion.`
                    : listing.closureReason
                      ? `Closure: ${listing.closureReason.replaceAll("_", " ")}.`
                      : "No update proposal is open."}
                </AlertDescription>
              </Alert>
            ) : null}
            {canUpdate && grant ? (
              <Alert>
                <ImagePlus />
                <AlertTitle>Version-specific cover</AlertTitle>
                <AlertDescription>
                  A platform-rendered cover is generated after submission. A
                  safe placeholder is shown if rendering is pending or fails.
                </AlertDescription>
              </Alert>
            ) : null}
            {canUpdate && !profile ? (
              <Alert>
                <ImagePlus />
                <AlertTitle>Confirm your public Creator profile</AlertTitle>
                <AlertDescription>
                  Choose the display name Gallery visitors will see. ShareSlices
                  never derives it from your email.
                </AlertDescription>
              </Alert>
            ) : null}
            {canFreshShare && !canUpdate && grant ? (
              <>
                {listing?.closureReason === "administrator_removal" ? (
                  <label className="flex items-start gap-3 rounded-md border border-destructive/40 p-4 text-sm">
                    <Checkbox
                      checked={confirmReplacement}
                      onCheckedChange={(value) =>
                        setConfirmReplacement(value === true)
                      }
                    />
                    <span>
                      <strong className="block">
                        Create an irreversible replacement
                      </strong>
                      This permanently forfeits restoration of the removed
                      listing and its prior URL.
                    </span>
                  </label>
                ) : null}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      pending ||
                      !versionId ||
                      !creatorDisplayName.trim() ||
                      (listing?.closureReason === "administrator_removal" &&
                        !confirmReplacement)
                    }
                  >
                    Share to Gallery
                  </Button>
                </DialogFooter>
              </>
            ) : null}
            {canUpdate && grant ? (
              <>
                <Field>
                  <FieldLabel htmlFor="gallery-version">Version</FieldLabel>
                  <Select
                    value={versionId}
                    onValueChange={(value) => setVersionId(value ?? "")}
                  >
                    <SelectTrigger id="gallery-version" className="w-full">
                      <SelectValue placeholder="Choose a ready Version" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {versions.map((version) => (
                          <SelectItem key={version.id} value={version.id}>
                            Version {version.versionNumber}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="gallery-display-name">
                      Creator display name
                    </FieldLabel>
                    <Input
                      id="gallery-display-name"
                      maxLength={80}
                      required
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="gallery-tags">
                      Tags, comma separated
                    </FieldLabel>
                    <Input
                      id="gallery-tags"
                      required
                      value={tags}
                      onChange={(event) => setTags(event.target.value)}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="gallery-bio">
                    Creator biography
                  </FieldLabel>
                  <Textarea
                    id="gallery-bio"
                    maxLength={500}
                    value={biography}
                    onChange={(event) => setBiography(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="gallery-title">Gallery title</FieldLabel>
                  <Input
                    id="gallery-title"
                    maxLength={200}
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="gallery-description">
                    Description
                  </FieldLabel>
                  <Textarea
                    id="gallery-description"
                    maxLength={2000}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
                <label className="flex items-start gap-3 rounded-md border p-4 text-sm">
                  <Checkbox
                    checked={accepted}
                    onCheckedChange={(value) => setAccepted(value === true)}
                  />
                  <span>
                    <strong className="block">
                      Accept Gallery permissions {grant.version}
                    </strong>
                    <span className="mt-1 block whitespace-pre-wrap text-muted-foreground">
                      {grant.exactText}
                    </span>
                  </span>
                </label>
                {listing?.closureReason === "administrator_removal" ? (
                  <label className="flex items-start gap-3 rounded-md border border-destructive/40 p-4 text-sm">
                    <Checkbox
                      checked={confirmReplacement}
                      onCheckedChange={(value) =>
                        setConfirmReplacement(value === true)
                      }
                    />
                    <span>
                      <strong className="block">
                        Create an irreversible replacement
                      </strong>
                      This permanently forfeits restoration of the removed
                      listing and its prior URL.
                    </span>
                  </label>
                ) : null}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    Close
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      pending ||
                      !accepted ||
                      !versionId ||
                      !displayName.trim() ||
                      (listing?.closureReason === "administrator_removal" &&
                        !confirmReplacement)
                    }
                  >
                    {pending ? (
                      <>
                        <Spinner />
                        Submitting…
                      </>
                    ) : canUpdate ? (
                      "Submit Gallery update"
                    ) : (
                      "Share to Gallery"
                    )}
                  </Button>
                </DialogFooter>
              </>
            ) : null}
            {listing &&
            (listing.lifecycle === "pending" ||
              listing.lifecycle === "listed") ? (
              <div className="mt-2 border-t pt-5">
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>Withdraw from Gallery permanently</AlertTitle>
                  <AlertDescription>
                    The Gallery URL is retired immediately. Share with link is
                    not changed.
                  </AlertDescription>
                </Alert>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={confirmWithdraw}
                    onCheckedChange={(value) =>
                      setConfirmWithdraw(value === true)
                    }
                  />
                  I understand this Gallery listing cannot be restored.
                </label>
                <Button
                  className="mt-3"
                  type="button"
                  variant="destructive"
                  disabled={pending || !confirmWithdraw}
                  onClick={withdraw}
                >
                  Withdraw from Gallery
                </Button>
              </div>
            ) : null}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function galleryMutationMessage(reason: unknown): string {
  if (reason instanceof GalleryApiError) {
    if (reason.code === "gallery_unavailable" || reason.status === 503)
      return "Gallery is temporarily unavailable. Try again later. Your Artifact has not changed.";
    if (reason.code === "listing_revision_conflict")
      return "Gallery changed since this dialog opened. Close it, review the current revision, and try again.";
    if (reason.code === "no_current_gallery_grant")
      return "There are no current Gallery permission terms to accept.";
    if (reason.code === "irreversible_replacement_confirmation_required")
      return "Confirm that the replacement permanently forfeits restoration of the removed listing.";
    if (reason.code === "idempotency_conflict" || reason.code === "listing_already_open")
      return "Gallery already has a share request for this Artifact. Close this dialog and review its current Gallery state.";
  }
  return "We couldn’t submit this Artifact to Gallery. Try again.";
}
