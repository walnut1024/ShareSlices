import {
  Check,
  CheckSquare2,
  CircleAlert,
  CloudUpload,
  Download,
  FileText,
  Filter,
  Grid2X2,
  Globe2,
  Info,
  List,
  Maximize,
  MoreVertical,
  Pencil,
  Search,
  Rocket,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type Artifact,
  artifactExportUrl,
  deleteArtifact,
  listArtifacts,
  publishArtifact,
  updateArtifactName,
} from "../api/artifacts";
import { Alert, AlertDescription } from "../components/ui/alert";
import { AspectRatio } from "../components/ui/aspect-ratio";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../components/ui/input-group";
import { Skeleton } from "../components/ui/skeleton";
import { Spinner } from "../components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip";
import { ArtifactShareDialog } from "./ArtifactShareDialog";
import { ArtifactGalleryDialog } from "./ArtifactGalleryDialog";
import { CreateArtifactDialog } from "./CreateArtifactDialog";
import { artifactPreviewUrl, versionContentUrl } from "../artifacts/preview";
import { ArtifactPlayer } from "../components/ArtifactPlayer";
import { cn } from "../lib/utils";
import { destinations } from "../routing";

type ArtifactFilter =
  | "all"
  | "published"
  | "ready"
  | "processing"
  | "attention";
type ViewMode = "grid" | "list";
type BatchExpiration = "permanent" | "7d" | "30d" | "custom";

const VIEW_STORAGE_KEY = "shareslices.artifacts.view.v1";

export function ArtifactsPage({
  creatorDisplayName,
  onAccepted,
}: {
  creatorDisplayName: string;
  onAccepted: (artifactId: string) => void;
}) {
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ArtifactFilter>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>(readStoredView);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchPublishOpen, setBatchPublishOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [publicationDialog, setPublicationDialog] = useState<{
    artifact: Artifact;
    mode: "publish" | "manage";
  } | null>(null);
  const [galleryArtifact, setGalleryArtifact] = useState<Artifact | null>(null);
  const [renameArtifact, setRenameArtifact] = useState<Artifact | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Artifact | null>(null);
  const [pending, setPending] = useState(false);
  const mutationGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    listArtifacts()
      .then((value) => active && setArtifacts(value))
      .catch(
        (reason: unknown) =>
          active &&
          setError(
            reason instanceof Error
              ? reason.message
              : "Artifacts could not be loaded.",
          ),
      );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage?.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // Browser storage is an optional preference, not required page state.
    }
  }, [view]);

  useEffect(() => {
    if (!selectionMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") exitSelectionMode();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectionMode]);

  const hasPendingThumbnail =
    artifacts?.some(
      (artifact) => artifact.readyVersion?.thumbnailState === "pending",
    ) ?? false;

  useEffect(() => {
    if (!hasPendingThumbnail) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const generation = mutationGeneration.current;
      try {
        const value = await listArtifacts();
        if (active && generation === mutationGeneration.current)
          setArtifacts(value);
      } catch {
        // Thumbnail refresh is best-effort and must not replace the loaded list.
      } finally {
        if (active) timer = setTimeout(refresh, 2_000);
      }
    };
    timer = setTimeout(refresh, 2_000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [hasPendingThumbnail]);

  const visibleArtifacts = useMemo(() => {
    if (!artifacts) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return artifacts.filter((artifact) => {
      const matchesFilter =
        filter === "all" || artifactFilter(artifact) === filter;
      const matchesQuery =
        !normalizedQuery ||
        artifact.name.toLowerCase().includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [artifacts, filter, query]);

  const selectedArtifacts = useMemo(
    () => artifacts?.filter((artifact) => selectedIds.has(artifact.id)) ?? [],
    [artifacts, selectedIds],
  );

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function handleAccepted(artifactId: string) {
    const generation = ++mutationGeneration.current;
    onAccepted(artifactId);
    listArtifacts()
      .then((value) => {
        if (generation === mutationGeneration.current) setArtifacts(value);
      })
      .catch((reason: unknown) => {
        if (generation === mutationGeneration.current)
          setError(
            reason instanceof Error
              ? reason.message
              : "Artifacts could not be loaded.",
          );
      });
  }

  function toggleSelected(artifactId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(artifactId)) next.delete(artifactId);
      else next.add(artifactId);
      return next;
    });
  }

  function toggleAllVisible() {
    const visibleIds = visibleArtifacts.map((artifact) => artifact.id);
    const allVisibleSelected = visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of visibleIds) {
        if (allVisibleSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function explainUnavailable(action: "publish" | "delete"): boolean {
    if (selectedArtifacts.length === 0) {
      toast.error("Select at least one artifact first.");
      return true;
    }
    const unavailable = selectedArtifacts.filter(
      (artifact) =>
        !artifact.allowedActions.includes(action) ||
        (action === "publish" && !artifact.readyVersion),
    );
    if (unavailable.length === 0) return false;
    const processingCount = unavailable.filter(
      (artifact) =>
        artifact.processingState === "accepted" ||
        artifact.processingState === "processing",
    ).length;
    const missingReadyVersionCount =
      action === "publish"
        ? unavailable.filter(
            (artifact) =>
              !artifact.readyVersion && artifact.processingState === "ready",
          ).length
        : 0;
    const otherCount =
      unavailable.length - processingCount - missingReadyVersionCount;
    const reasons = [
      processingCount > 0
        ? `${processingCount} ${processingCount === 1 ? "is" : "are"} still processing`
        : null,
      missingReadyVersionCount > 0
        ? `${missingReadyVersionCount} ${missingReadyVersionCount === 1 ? "has" : "have"} no ready Version`
        : null,
      otherCount > 0
        ? `${otherCount} ${otherCount === 1 ? "is" : "are"} not eligible`
        : null,
    ]
      .filter(Boolean)
      .join("; ");
    toast.error(
      `${unavailable.length} selected ${unavailable.length === 1 ? "artifact" : "artifacts"} cannot be ${action === "publish" ? "published" : "deleted"} because ${reasons}.`,
    );
    return true;
  }

  function openBatchPublish() {
    if (!explainUnavailable("publish")) setBatchPublishOpen(true);
  }

  function openBatchDelete() {
    if (!explainUnavailable("delete")) setBatchDeleteOpen(true);
  }

  function updateOne(updated: Artifact) {
    setArtifacts(
      (current) =>
        current?.map((artifact) =>
          artifact.id === updated.id ? updated : artifact,
        ) ?? current,
    );
    setPublicationDialog((current) =>
      current?.artifact.id === updated.id
        ? { ...current, artifact: updated }
        : current,
    );
  }

  async function rename(name: string) {
    if (!renameArtifact) return;
    setPending(true);
    try {
      updateOne(await updateArtifactName(renameArtifact.id, name.trim()));
      setRenameArtifact(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The artifact could not be renamed.",
      );
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setPending(true);
    try {
      await deleteArtifact(deleteTarget.id);
      setArtifacts(
        (current) =>
          current?.filter((artifact) => artifact.id !== deleteTarget.id) ??
          current,
      );
      setDeleteTarget(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The artifact could not be deleted.",
      );
    } finally {
      setPending(false);
    }
  }

  async function publishSelected(
    expiration: BatchExpiration,
    customExpiration: string,
  ) {
    const exactExpiration =
      expiration === "custom" ? futureIso(customExpiration) : null;
    if (expiration === "custom" && !exactExpiration) {
      toast.error("Choose a future expiration date and time.");
      return;
    }
    mutationGeneration.current += 1;
    setPending(true);
    const results = await mapWithConcurrency(
      selectedArtifacts,
      3,
      async (artifact) => {
        const response = await publishArtifact(
          artifact.id,
          {
            versionId: artifact.readyVersion!.id,
            expiration:
              expiration === "permanent"
                ? { kind: "permanent" }
                : expiration === "custom"
                  ? { kind: "exact", expiresAt: exactExpiration! }
                  : {
                      kind: "duration",
                      durationSeconds: expiration === "7d" ? 604800 : 2592000,
                    },
            link: { mode: "reuse" },
          },
          crypto.randomUUID(),
        );
        if (!response || !("artifact" in response))
          throw new Error("The published artifact response was incomplete.");
        return response.artifact;
      },
    );
    const succeeded = results.filter((result) => result.status === "fulfilled");
    const failed = results.filter((result) => result.status === "rejected");
    for (const result of succeeded) updateOne(result.value);
    setPending(false);
    if (failed.length === 0) {
      toast.success(
        `${succeeded.length} ${succeeded.length === 1 ? "artifact" : "artifacts"} published.`,
      );
      setBatchPublishOpen(false);
      exitSelectionMode();
      return;
    }
    const failedIds = new Set(failed.map((result) => result.item.id));
    setSelectedIds(failedIds);
    setBatchPublishOpen(false);
    toast.error(
      `${succeeded.length} published, ${failed.length} failed. ${errorMessage(failed[0]!.reason)}`,
    );
  }

  async function deleteSelected() {
    mutationGeneration.current += 1;
    setPending(true);
    const results = await mapWithConcurrency(
      selectedArtifacts,
      3,
      async (artifact) => {
        await deleteArtifact(artifact.id);
      },
    );
    const succeeded = results.filter((result) => result.status === "fulfilled");
    const failed = results.filter((result) => result.status === "rejected");
    const succeededIds = new Set(succeeded.map((result) => result.item.id));
    setArtifacts(
      (current) =>
        current?.filter((artifact) => !succeededIds.has(artifact.id)) ??
        current,
    );
    setPending(false);
    setBatchDeleteOpen(false);
    if (failed.length === 0) {
      toast.success(
        `${succeeded.length} ${succeeded.length === 1 ? "artifact" : "artifacts"} deleted.`,
      );
      exitSelectionMode();
      return;
    }
    setSelectedIds(new Set(failed.map((result) => result.item.id)));
    toast.error(
      `${succeeded.length} deleted, ${failed.length} failed. ${errorMessage(failed[0]!.reason)}`,
    );
  }

  return (
    <div
      data-testid="artifacts-page"
      className="mx-auto flex min-h-[calc(100vh-110px)] w-full max-w-[1920px] flex-col"
    >
      <div className="mb-5 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">
            Artifacts
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Manage, review, and share uploaded Artifacts by link or in Gallery.
          </p>
        </div>
        <CreateArtifactDialog onAccepted={handleAccepted} />
      </div>

      {error ? (
        <Alert className="mb-4" variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!error && selectionMode ? (
        <div className="mb-[18px] flex min-h-12 items-center justify-between gap-4 border-b pb-3.5">
          <div className="flex items-center gap-3">
            <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-foreground text-background">
              <Check aria-hidden="true" className="size-3" />
            </span>
            <span className="text-[13.5px] font-semibold">
              {selectedIds.size} selected
            </span>
            <span aria-hidden="true" className="h-[18px] w-px bg-border" />
            <Button size="sm" variant="ghost" onClick={toggleAllVisible}>
              {visibleArtifacts.every((artifact) =>
                selectedIds.has(artifact.id),
              )
                ? `Deselect all ${visibleArtifacts.length}`
                : `Select all ${visibleArtifacts.length}`}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <InputGroup className="w-[200px]">
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search artifacts"
                placeholder="Search artifacts…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>
            <ToggleGroup
              aria-label="Artifact view"
              value={[view]}
              onValueChange={(value) => {
                const next = value[0] as ViewMode | undefined;
                if (next) setView(next);
              }}
            >
              <ToggleGroupItem aria-label="Grid view" value="grid">
                <Grid2X2 />
              </ToggleGroupItem>
              <ToggleGroupItem aria-label="List view" value="list">
                <List />
              </ToggleGroupItem>
            </ToggleGroup>
            <Button size="sm" onClick={openBatchPublish}>
              <Rocket data-icon="inline-start" />
              Share with link
            </Button>
            <Button size="sm" variant="destructive" onClick={openBatchDelete}>
              <Trash2 data-icon="inline-start" />
              Delete
            </Button>
            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
            <Button
              aria-label="Exit selection mode"
              size="icon-sm"
              variant="ghost"
              onClick={exitSelectionMode}
            >
              <X />
            </Button>
          </div>
        </div>
      ) : !error ? (
        <div className="mb-[18px] flex items-center justify-between gap-4 border-b pb-3.5">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              <strong className="font-medium text-foreground">
                {artifacts?.length ?? 0}
              </strong>{" "}
              artifacts
            </span>
            <span
              aria-hidden="true"
              className="size-[3px] rounded-full bg-border"
            />
            <span>
              Sorted by{" "}
              <strong className="font-medium text-foreground">
                last modified
              </strong>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <InputGroup className="w-[248px]">
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search artifacts"
                placeholder="Search artifacts…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>
            {artifacts && artifacts.length > 0 ? (
              <Button variant="outline" onClick={() => setSelectionMode(true)}>
                <CheckSquare2 data-icon="inline-start" />
                Select
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                {" "}
                <Filter aria-hidden="true" data-icon="inline-start" />
                Filter
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  {(
                    [
                      "all",
                      "published",
                      "ready",
                      "processing",
                      "attention",
                    ] as ArtifactFilter[]
                  ).map((value) => (
                    <DropdownMenuItem
                      key={value}
                      onClick={() => setFilter(value)}
                    >
                      {filter === value ? (
                        <Check aria-hidden="true" />
                      ) : (
                        <span className="size-4" />
                      )}
                      {filterLabel(value)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <ToggleGroup
              aria-label="Artifact view"
              value={[view]}
              onValueChange={(value) => {
                const next = value[0] as ViewMode | undefined;
                if (next) setView(next);
              }}
            >
              <ToggleGroupItem aria-label="Grid view" value="grid">
                <Grid2X2 />
              </ToggleGroupItem>
              <ToggleGroupItem aria-label="List view" value="list">
                <List />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      ) : null}

      {artifacts === null && !error ? <ArtifactGridSkeleton /> : null}
      {artifacts?.length === 0 ? (
        <InitialEmptyState onAccepted={handleAccepted} />
      ) : null}
      {artifacts && artifacts.length > 0 && visibleArtifacts.length === 0 ? (
        <FilteredEmptyState
          onClear={() => {
            setQuery("");
            setFilter("all");
          }}
        />
      ) : null}
      {visibleArtifacts.length > 0 && view === "grid" ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(310px,1fr))] gap-5">
          {visibleArtifacts.map((artifact, index) => (
            <ArtifactTile
              key={artifact.id}
              artifact={artifact}
              index={index}
              selected={selectedIds.has(artifact.id)}
              selectionMode={selectionMode}
              onSelect={() => toggleSelected(artifact.id)}
              onPublication={() =>
                setPublicationDialog({
                  artifact,
                  mode:
                    artifact.publicationStatus === "published"
                      ? "manage"
                      : "publish",
                })
              }
              onGallery={() => setGalleryArtifact(artifact)}
              onRename={() => setRenameArtifact(artifact)}
              onDelete={() => setDeleteTarget(artifact)}
            />
          ))}
        </ul>
      ) : null}
      {visibleArtifacts.length > 0 && view === "list" ? (
        <ArtifactList
          artifacts={visibleArtifacts}
          selectedIds={selectedIds}
          selectionMode={selectionMode}
          onSelect={toggleSelected}
          onPublication={(artifact) =>
            setPublicationDialog({
              artifact,
              mode:
                artifact.publicationStatus === "published"
                  ? "manage"
                  : "publish",
            })
          }
          onGallery={setGalleryArtifact}
          onRename={setRenameArtifact}
          onDelete={setDeleteTarget}
        />
      ) : null}

      <ArtifactShareDialog
        artifact={publicationDialog?.artifact ?? null}
        mode={publicationDialog?.mode ?? "publish"}
        onOpenChange={(open) => !open && setPublicationDialog(null)}
        onUpdated={updateOne}
      />
      {galleryArtifact ? (
        <ArtifactGalleryDialog
          artifact={galleryArtifact}
          creatorDisplayName={creatorDisplayName}
          open
          onOpenChange={(open) => !open && setGalleryArtifact(null)}
        />
      ) : null}
      <RenameDialog
        artifact={renameArtifact}
        pending={pending}
        onClose={() => setRenameArtifact(null)}
        onSubmit={(name) => void rename(name)}
      />
      <DeleteDialog
        artifact={deleteTarget}
        pending={pending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
      />
      <BatchPublishDialog
        count={selectedArtifacts.length}
        open={batchPublishOpen}
        pending={pending}
        onClose={() => setBatchPublishOpen(false)}
        onConfirm={(expiration, customExpiration) =>
          void publishSelected(expiration, customExpiration)
        }
      />
      <BatchDeleteDialog
        count={selectedArtifacts.length}
        open={batchDeleteOpen}
        pending={pending}
        onClose={() => setBatchDeleteOpen(false)}
        onConfirm={() => void deleteSelected()}
      />
    </div>
  );
}

function ArtifactTile({
  artifact,
  index,
  selected,
  selectionMode,
  onSelect,
  onPublication,
  onGallery,
  onRename,
  onDelete,
}: {
  artifact: Artifact;
  index: number;
  selected: boolean;
  selectionMode: boolean;
  onSelect: () => void;
  onPublication: () => void;
  onGallery: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const ready = artifact.readyVersion !== null;
  const detailUrl = destinations.artifact(artifact.id);
  const previewUrl = ready
    ? artifactPreviewUrl(artifact.id, artifact.readyVersion!.id)
    : null;
  const cardRef = useRef<HTMLDivElement>(null);
  const [fullscreenVersionId, setFullscreenVersionId] = useState<string | null>(
    null,
  );

  async function enterFullscreen(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const card = cardRef.current;
    const versionId = artifact.readyVersion?.id;
    if (!card || !versionId || !card.requestFullscreen) {
      toast.error("Full screen could not be opened.");
      return;
    }
    try {
      await card.requestFullscreen();
      const active = document.fullscreenElement;
      if (active === card || (active && card.contains(active)))
        setFullscreenVersionId(versionId);
    } catch {
      setFullscreenVersionId(null);
      toast.error("Full screen could not be opened.");
    }
  }

  return (
    <li className="relative">
      <Card
        ref={cardRef}
        className={cn(
          "relative gap-0 overflow-visible py-0 fullscreen:h-screen fullscreen:w-screen fullscreen:overflow-hidden fullscreen:rounded-none fullscreen:ring-0",
          selected
            ? "shadow-none ring-2 ring-foreground"
            : "shadow-[0_1px_2px_rgba(9,9,11,0.05)] ring-border transition-[box-shadow,outline-color] hover:shadow-[0_6px_18px_-10px_rgba(9,9,11,0.22)] hover:ring-foreground/20",
        )}
      >
        {selectionMode ? (
          <button
            aria-label={`${selected ? "Deselect" : "Select"} ${artifact.name}`}
            className="absolute inset-0 z-30 rounded-xl"
            type="button"
            onClick={onSelect}
          />
        ) : (
          <a
            aria-label={artifact.name}
            className="absolute inset-0 z-0 rounded-xl"
            href={detailUrl}
          />
        )}
        <AspectRatio ratio={16 / 9}>
          <CardContent
            className={cn("relative flex h-full items-center justify-center overflow-hidden rounded-t-xl p-0", previewClass(artifact, index))}
          >
            <FileText
              aria-hidden="true"
              className="size-9 text-muted-foreground/55"
            />
            {artifact.readyVersion?.thumbnailState === "ready" ? (
              <img
                alt=""
                className="absolute inset-0 size-full object-cover"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
                src={`/api/versions/${encodeURIComponent(artifact.readyVersion.id)}/thumbnail`}
              />
            ) : null}
            {!selectionMode &&
            previewUrl &&
            artifact.allowedActions.includes("preview") ? (
              <a
                aria-label={`Preview ${artifact.name}`}
                className="absolute inset-0 z-10 cursor-pointer"
                href={previewUrl}
                rel="noopener"
                target="_blank"
              />
            ) : null}
            {selectionMode ? (
              <>
                <span
                  aria-hidden="true"
                  className={selected ? "absolute inset-0 bg-foreground/5" : ""}
                />
                <Checkbox
                  aria-label={`Select ${artifact.name}`}
                  checked={selected}
                  className="absolute top-2 left-2 z-40 bg-background/95"
                  onCheckedChange={onSelect}
                />
              </>
            ) : (
              <div className="pointer-events-none absolute top-2 left-2 z-20">
                <StatusBadge artifact={artifact} overlay />
              </div>
            )}
            {!selectionMode ? (
              <div className="absolute right-2 bottom-2 z-20 flex gap-1.5">
                {ready && artifact.allowedActions.includes("preview") ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          aria-label={`Enter full screen for ${artifact.name}`}
                          className="bg-background/95 shadow-none"
                          size="icon-xs"
                          variant="outline"
                          onClick={(event) => void enterFullscreen(event)}
                        />
                      }
                    >
                      <Maximize aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent>Enter full screen</TooltipContent>
                  </Tooltip>
                ) : null}
                {ready &&
                (artifact.allowedActions.includes("publish") ||
                  artifact.allowedActions.includes("manage_publication")) ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          aria-label={`${artifact.publicationStatus === "published" ? "Manage link for" : "Share with link"} ${artifact.name}`}
                          className="bg-background/95 shadow-none"
                          size="icon-xs"
                          variant="outline"
                          onClick={onPublication}
                        />
                      }
                    >
                      <Rocket aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent>
                      {artifact.publicationStatus === "published"
                        ? "Manage link"
                        : "Share with link"}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                {ready ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          aria-label={`Share ${artifact.name} to Gallery`}
                          className="bg-background/95 shadow-none"
                          size="icon-xs"
                          variant="outline"
                          onClick={onGallery}
                        />
                      }
                    >
                      <Globe2 aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent>Share to Gallery</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </AspectRatio>
        <CardFooter className="pointer-events-none min-h-16 flex-col items-start gap-0 border-t border-muted px-3 pt-[11px] pb-[13px]">
          <ArtifactCardName name={artifact.name} />
          <span className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
            {formatModified(artifact.updatedAt)}
          </span>
        </CardFooter>
        {fullscreenVersionId ? (
          <div className="absolute inset-0 z-50">
            <ArtifactPlayer
              contentUrl={versionContentUrl(fullscreenVersionId)}
              fullscreenTargetRef={cardRef}
              onFullscreenExit={() => setFullscreenVersionId(null)}
            />
          </div>
        ) : null}
      </Card>
      {!selectionMode ? (
        <div className="absolute top-2 right-2 z-30">
          <ArtifactMenu
            artifact={artifact}
            detailUrl={detailUrl}
            overlay
            onGallery={onGallery}
            onRename={onRename}
            onDelete={onDelete}
          />
        </div>
      ) : null}
    </li>
  );
}

function ArtifactList({
  artifacts,
  selectedIds,
  selectionMode,
  onSelect,
  onPublication,
  onGallery,
  onRename,
  onDelete,
}: {
  artifacts: Artifact[];
  selectedIds: Set<string>;
  selectionMode: boolean;
  onSelect: (artifactId: string) => void;
  onPublication: (artifact: Artifact) => void;
  onGallery: (artifact: Artifact) => void;
  onRename: (artifact: Artifact) => void;
  onDelete: (artifact: Artifact) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            {selectionMode ? (
              <TableHead className="w-12">
                <span className="sr-only">Selected</span>
              </TableHead>
            ) : null}
            <TableHead>Artifact</TableHead>
            <TableHead className="w-44">Processing</TableHead>
            <TableHead className="w-44">Publication</TableHead>
            <TableHead className="w-48">Last modified</TableHead>
            <TableHead className="w-14">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {artifacts.map((artifact) => {
            const selected = selectedIds.has(artifact.id);
            const detailUrl = destinations.artifact(artifact.id);
            return (
              <TableRow
                key={artifact.id}
                aria-label={`Open ${artifact.name}`}
                className={!selectionMode ? "cursor-pointer" : undefined}
                data-state={selected ? "selected" : undefined}
                tabIndex={!selectionMode ? 0 : undefined}
                onClick={(event) => {
                  if (
                    !selectionMode &&
                    (!(event.target instanceof Element) ||
                      !event.target.closest("a,button"))
                  )
                    window.location.href = detailUrl;
                }}
                onKeyDown={(event) => {
                  if (!selectionMode && event.key === "Enter")
                    window.location.href = detailUrl;
                }}
              >
                {selectionMode ? (
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select ${artifact.name}`}
                      checked={selected}
                      onCheckedChange={() => onSelect(artifact.id)}
                    />
                  </TableCell>
                ) : null}
                <TableCell>
                  <a className="font-medium hover:underline" href={detailUrl}>
                    {artifact.name}
                  </a>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {processingLabel(artifact)}
                </TableCell>
                <TableCell>
                  <StatusBadge artifact={artifact} />
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {formatModified(artifact.updatedAt)}
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  {!selectionMode ? (
                    <ArtifactMenu
                      artifact={artifact}
                      detailUrl={detailUrl}
                      onPublication={() => onPublication(artifact)}
                      onGallery={() => onGallery(artifact)}
                      onRename={() => onRename(artifact)}
                      onDelete={() => onDelete(artifact)}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ArtifactCardName({ name }: { name: string }) {
  const parts = splitArtifactName(name);
  return (
    <span
      className="flex w-full min-w-0 items-baseline text-[13px] font-medium"
      title={name}
    >
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {parts.head}
      </span>
      <span className="max-w-1/3 shrink-0 overflow-hidden whitespace-nowrap [direction:rtl] [text-align:left]">
        {parts.tail}
      </span>
    </span>
  );
}

function splitArtifactName(name: string): { head: string; tail: string } {
  const tailLength = Math.ceil(name.length / 3);
  return { head: name.slice(0, -tailLength), tail: name.slice(-tailLength) };
}

function ArtifactMenu({
  artifact,
  detailUrl,
  overlay = false,
  onPublication,
  onGallery,
  onRename,
  onDelete,
}: {
  artifact: Artifact;
  detailUrl: string;
  overlay?: boolean;
  onPublication?: () => void;
  onGallery?: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`More actions for ${artifact.name}`}
            className={
              overlay ? "bg-background/95 shadow-none" : "bg-white/95 shadow-sm"
            }
            size="icon-xs"
            variant="outline"
          />
        }
      >
        <MoreVertical aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              window.location.href = detailUrl;
            }}
          >
            <Info />
            Info
          </DropdownMenuItem>
          {onPublication &&
          artifact.readyVersion &&
          (artifact.allowedActions.includes("publish") ||
            artifact.allowedActions.includes("manage_publication")) ? (
            <DropdownMenuItem onClick={onPublication}>
              <Rocket />
              {artifact.publicationStatus === "published"
                ? "Manage link"
                : "Share with link"}
            </DropdownMenuItem>
          ) : null}
          {onGallery && artifact.readyVersion ? (
            <DropdownMenuItem onClick={onGallery}>
              <Globe2 />
              Share to Gallery
            </DropdownMenuItem>
          ) : null}
          {artifact.allowedActions.includes("export") &&
          artifact.readyVersion ? (
            <DropdownMenuItem
              onClick={() => {
                window.location.href = artifactExportUrl(
                  artifact.readyVersion!.id,
                );
              }}
            >
              <Download />
              Export
            </DropdownMenuItem>
          ) : null}
          {artifact.allowedActions.includes("rename") ? (
            <DropdownMenuItem onClick={onRename}>
              <Pencil />
              Rename
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        {artifact.allowedActions.includes("delete") ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RenameDialog({
  artifact,
  pending,
  onClose,
  onSubmit,
}: {
  artifact: Artifact | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => setName(artifact?.name ?? ""), [artifact]);
  if (!artifact) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Rename artifact</DialogTitle>
          <DialogDescription>
            Change the owner-facing name without changing its link.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(name);
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="rename-artifact">Artifact name</FieldLabel>
              <Input
                id="rename-artifact"
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-5">
            <DialogClose
              render={
                <Button type="button" variant="secondary" disabled={pending} />
              }
            >
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? <Spinner data-icon="inline-start" /> : null}Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  artifact,
  pending,
  onClose,
  onConfirm,
}: {
  artifact: Artifact | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!artifact) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[396px]">
        <DialogHeader>
          <DialogTitle>Delete Artifact?</DialogTitle>
          <DialogDescription>
            This retires its Share link, any Gallery proposal and Gallery URL,
            then deletes {artifact.name}, its Versions, and stored files.
            Physical cleanup may wait for active governance evidence, accepted
            copies, or authorized Downloads. Completed independent copies are
            unchanged.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="secondary" disabled={pending} />
            }
          >
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Trash2 data-icon="inline-start" />
            )}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchPublishDialog({
  count,
  open,
  pending,
  onClose,
  onConfirm,
}: {
  count: number;
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: (expiration: BatchExpiration, customExpiration: string) => void;
}) {
  const [expiration, setExpiration] = useState<BatchExpiration>("permanent");
  const [customExpiration, setCustomExpiration] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && !pending && onClose()}
    >
      <DialogContent className="sm:max-w-[480px]" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Share {count} Artifacts with links</DialogTitle>
          <DialogDescription>
            Share the latest ready Version of each selected Artifact. Existing
            Share links are reused. This does not share anything to Gallery.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="batch-publication-expiration">
              Access period
            </FieldLabel>
            <Select
              items={batchExpirationOptions}
              value={expiration}
              onValueChange={(value) => setExpiration(value as BatchExpiration)}
            >
              <SelectTrigger
                id="batch-publication-expiration"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {batchExpirationOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {expiration === "custom" ? (
            <Field>
              <FieldLabel htmlFor="batch-custom-expiration">
                Custom expiration
              </FieldLabel>
              <Input
                id="batch-custom-expiration"
                type="datetime-local"
                value={customExpiration}
                onChange={(event) => setCustomExpiration(event.target.value)}
              />
            </Field>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => onConfirm(expiration, customExpiration)}
          >
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Rocket data-icon="inline-start" />
            )}
            Share {count} with links
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchDeleteDialog({
  count,
  open,
  pending,
  onClose,
  onConfirm,
}: {
  count: number;
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && !pending && onClose()}
    >
      <DialogContent className="sm:max-w-[440px]" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Delete {count} Artifacts?</DialogTitle>
          <DialogDescription>
            This retires their Share links, Gallery proposals, and Gallery URLs,
            then deletes their Versions and stored files. Cleanup may wait for
            governance evidence, accepted copies, or authorized Downloads.
            Completed independent copies remain.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Trash2 data-icon="inline-start" />
            )}
            Delete {count} artifacts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({
  artifact,
  overlay = false,
}: {
  artifact: Artifact;
  overlay?: boolean;
}) {
  const publicationLabels = {
    not_published: "Link not active",
    published: "Link active",
    expired: "Link expired",
    unpublished: "Link stopped",
  } as const;
  const label =
    artifact.processingState === "failed"
      ? "Needs attention"
      : artifact.processingState === "ready"
        ? publicationLabels[artifact.publicationStatus]
        : artifact.processingState === "processing"
          ? "Processing"
          : "Accepted";
  return (
    <Badge
      className={
        overlay ? "bg-background/95 shadow-none" : "bg-white/95 shadow-sm"
      }
      variant="outline"
    >
      {artifact.publicationStatus === "published" ? (
        <span className="size-1.5 rounded-full bg-[var(--success)]" />
      ) : null}
      {label}
    </Badge>
  );
}

function InitialEmptyState({
  onAccepted,
}: {
  onAccepted: (artifactId: string) => void;
}) {
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <Empty
      className={
        dragging
          ? "min-h-[380px] rounded-[14px] border border-dashed border-foreground/40 bg-muted/60 p-12 ring-3 ring-ring/20"
          : "min-h-[380px] rounded-[14px] border border-dashed bg-muted/35 p-12"
      }
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        setDroppedFile(event.dataTransfer.files[0] ?? null);
      }}
    >
      <EmptyHeader>
        <span className="mb-1 flex size-13 items-center justify-center rounded-[14px] bg-muted text-muted-foreground">
          <CloudUpload aria-hidden="true" />
        </span>
        <EmptyTitle>
          <h2>No artifacts yet</h2>
        </EmptyTitle>
        <EmptyDescription className="flex flex-col">
          <span>Upload your first artifact to start sharing.</span>
          <span>
            Drag and drop a ZIP or self-contained HTML file here, or use the
            button below.
          </span>
        </EmptyDescription>
      </EmptyHeader>
      <CreateArtifactDialog initialFile={droppedFile} onAccepted={onAccepted} />
    </Empty>
  );
}

function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <Empty className="min-h-[320px]">
      <EmptyHeader>
        <EmptyTitle>
          <h2>No artifacts found</h2>
        </EmptyTitle>
        <EmptyDescription>
          No artifacts match the current search and filters.
        </EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" onClick={onClear}>
        Clear search and filters
      </Button>
    </Empty>
  );
}

function ArtifactGridSkeleton() {
  return (
    <div
      aria-label="Loading artifacts"
      className="grid grid-cols-[repeat(auto-fill,minmax(310px,1fr))] gap-5"
    >
      {Array.from({ length: 10 }, (_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-xl ring-1 ring-foreground/10"
        >
          <Skeleton className="aspect-video rounded-none" />
          <div className="min-h-16 border-t border-muted bg-muted/50" />
        </div>
      ))}
    </div>
  );
}

function artifactFilter(artifact: Artifact): Exclude<ArtifactFilter, "all"> {
  if (artifact.processingState === "failed") return "attention";
  if (
    artifact.processingState === "accepted" ||
    artifact.processingState === "processing"
  )
    return "processing";
  if (artifact.publicationStatus === "published") return "published";
  return "ready";
}

function filterLabel(filter: ArtifactFilter): string {
  return {
    all: "All artifacts",
    published: "Published",
    ready: "Ready",
    processing: "Processing",
    attention: "Needs attention",
  }[filter];
}

function previewClass(artifact: Artifact, index: number): string {
  if (artifact.processingState === "failed") return "bg-destructive/5";
  if (
    artifact.processingState === "accepted" ||
    artifact.processingState === "processing"
  )
    return "bg-muted";
  return index % 3 === 1
    ? "artifact-preview-warm"
    : index % 3 === 2
      ? "artifact-preview-green"
      : "artifact-preview-cool";
}

function formatModified(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en", {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date)
    : "Recently updated";
}

const batchExpirationOptions = [
  { label: "Permanent", value: "permanent" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "Custom date and time", value: "custom" },
] satisfies { label: string; value: BatchExpiration }[];

function readStoredView(): ViewMode {
  try {
    return window.localStorage?.getItem(VIEW_STORAGE_KEY) === "list"
      ? "list"
      : "grid";
  } catch {
    return "grid";
  }
}

function processingLabel(artifact: Artifact): string {
  return {
    accepted: "Accepted",
    processing: "Processing",
    ready: "Ready",
    failed: "Needs attention",
  }[artifact.processingState];
}

function futureIso(value: string): string | null {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) && date > new Date()
    ? date.toISOString()
    : null;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : "The operation could not be completed.";
}

type ConcurrentResult<TItem, TValue> =
  | { status: "fulfilled"; item: TItem; value: TValue }
  | { status: "rejected"; item: TItem; reason: unknown };

async function mapWithConcurrency<TItem, TValue>(
  items: TItem[],
  limit: number,
  operation: (item: TItem) => Promise<TValue>,
): Promise<ConcurrentResult<TItem, TValue>[]> {
  const results: ConcurrentResult<TItem, TValue>[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index]!;
      try {
        results[index] = {
          status: "fulfilled",
          item,
          value: await operation(item),
        };
      } catch (reason) {
        results[index] = { status: "rejected", item, reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
