import {
  Check,
  CircleAlert,
  Download,
  FileText,
  Filter,
  Grid2X2,
  Info,
  List,
  MoreVertical,
  Pencil,
  Search,
  Rocket,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type Artifact,
  artifactExportUrl,
  deleteArtifact,
  listArtifacts,
  updateArtifactName
} from "../api/artifacts";
import { Alert, AlertDescription } from "../components/ui/alert";
import { AspectRatio } from "../components/ui/aspect-ratio";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter } from "../components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { Skeleton } from "../components/ui/skeleton";
import { Spinner } from "../components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { ArtifactShareDialog } from "./ArtifactShareDialog";
import { CreateArtifactDialog } from "./CreateArtifactDialog";

type ArtifactFilter = "all" | "published" | "ready" | "processing" | "attention";
type ViewMode = "grid" | "list";

export function ArtifactsPage({ onAccepted }: { onAccepted: (artifactId: string) => void }) {
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ArtifactFilter>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [publicationDialog, setPublicationDialog] = useState<{ artifact: Artifact; mode: "publish" | "manage" } | null>(null);
  const [renameArtifact, setRenameArtifact] = useState<Artifact | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Artifact | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    listArtifacts()
      .then((value) => active && setArtifacts(value))
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : "Artifacts could not be loaded."));
    return () => {
      active = false;
    };
  }, []);

  const hasPendingThumbnail = artifacts?.some(
    (artifact) => artifact.readyVersion?.thumbnailState === "pending"
  ) ?? false;

  useEffect(() => {
    if (!hasPendingThumbnail) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const value = await listArtifacts();
        if (active) setArtifacts(value);
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
      const matchesFilter = filter === "all" || artifactFilter(artifact) === filter;
      const matchesQuery = !normalizedQuery || `${artifact.name} ${artifact.id}`.toLowerCase().includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [artifacts, filter, query]);

  function updateOne(updated: Artifact) {
    setArtifacts((current) => current?.map((artifact) => artifact.id === updated.id ? updated : artifact) ?? current);
    setPublicationDialog((current) => current?.artifact.id === updated.id ? { ...current, artifact: updated } : current);
  }

  async function rename(name: string) {
    if (!renameArtifact) return;
    setPending(true);
    try {
      updateOne(await updateArtifactName(renameArtifact.id, name.trim()));
      setRenameArtifact(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The artifact could not be renamed.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setPending(true);
    try {
      await deleteArtifact(deleteTarget.id);
      setArtifacts((current) => current?.filter((artifact) => artifact.id !== deleteTarget.id) ?? current);
      setDeleteTarget(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The artifact could not be deleted.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-110px)] flex-col">
      <div className="mb-5 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Artifacts</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Manage, review and publish uploaded artifacts.</p>
        </div>
        <CreateArtifactDialog onAccepted={onAccepted} />
      </div>

      {error ? <Alert className="mb-4" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {!error ? (
        <div className="mb-[18px] flex items-center justify-between gap-4 border-b pb-3.5">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span><strong className="font-medium text-foreground">{artifacts?.length ?? 0}</strong> artifacts</span>
            <span aria-hidden="true" className="size-[3px] rounded-full bg-border" />
            <span>Sorted by <strong className="font-medium text-foreground">last modified</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <InputGroup className="w-[248px]">
              <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
              <InputGroupInput aria-label="Search artifacts" placeholder="Search artifacts…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </InputGroup>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}> <Filter aria-hidden="true" data-icon="inline-start" />Filter</DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  {(["all", "published", "ready", "processing", "attention"] as ArtifactFilter[]).map((value) => (
                    <DropdownMenuItem key={value} onClick={() => setFilter(value)}>
                      {filter === value ? <Check aria-hidden="true" /> : <span className="size-4" />}
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
              <ToggleGroupItem aria-label="Grid view" value="grid"><Grid2X2 /></ToggleGroupItem>
              <ToggleGroupItem aria-label="List view" value="list"><List /></ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      ) : null}

      {artifacts === null && !error ? <ArtifactGridSkeleton /> : null}
      {artifacts?.length === 0 ? <EmptyState title="No artifacts yet" description="Upload your first artifact to start sharing." /> : null}
      {artifacts && artifacts.length > 0 && visibleArtifacts.length === 0 ? <EmptyState title="No matching artifacts" description="Try another filter or search term." /> : null}
      {visibleArtifacts.length > 0 ? (
        <ul className={view === "grid" ? "grid grid-cols-5 gap-3.5" : "flex flex-col gap-2"}>
          {visibleArtifacts.map((artifact, index) => (
            <ArtifactTile
              key={artifact.id}
              artifact={artifact}
              index={index}
              view={view}
              onPublication={() => setPublicationDialog({ artifact, mode: artifact.publicationStatus === "published" ? "manage" : "publish" })}
              onRename={() => setRenameArtifact(artifact)}
              onDelete={() => setDeleteTarget(artifact)}
            />
          ))}
        </ul>
      ) : null}

      <ArtifactShareDialog artifact={publicationDialog?.artifact ?? null} mode={publicationDialog?.mode ?? "publish"} onOpenChange={(open) => !open && setPublicationDialog(null)} onUpdated={updateOne} />
      <RenameDialog artifact={renameArtifact} pending={pending} onClose={() => setRenameArtifact(null)} onSubmit={(name) => void rename(name)} />
      <DeleteDialog artifact={deleteTarget} pending={pending} onClose={() => setDeleteTarget(null)} onConfirm={() => void remove()} />
    </div>
  );
}

function ArtifactTile({
  artifact,
  index,
  view,
  onPublication,
  onRename,
  onDelete
}: {
  artifact: Artifact;
  index: number;
  view: ViewMode;
  onPublication: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const ready = artifact.readyVersion !== null;
  const detailUrl = `/artifacts/${encodeURIComponent(artifact.id)}`;
  const previewUrl = ready ? `/api/versions/${encodeURIComponent(artifact.readyVersion!.id)}/content/` : null;

  if (view === "list") {
    return (
      <li>
        <Card className="flex-row items-center gap-3 py-2.5 pr-2.5 pl-3">
          <FileText aria-hidden="true" className="size-5 text-muted-foreground" />
          <a className="min-w-0 flex-1" href={detailUrl}><span className="block truncate text-sm font-medium">{artifact.name}</span><span className="text-xs text-muted-foreground">{formatModified(artifact.updatedAt)}</span></a>
          <StatusBadge artifact={artifact} />
          <ArtifactMenu artifact={artifact} detailUrl={detailUrl} onRename={onRename} onDelete={onDelete} />
        </Card>
      </li>
    );
  }

  return (
    <li className="relative">
      <Card className="relative gap-0 overflow-visible py-0 shadow-[0_1px_2px_rgba(9,9,11,0.05)] ring-border transition-[box-shadow,outline-color] hover:shadow-[0_6px_18px_-10px_rgba(9,9,11,0.22)] hover:ring-foreground/20">
        <a aria-label={artifact.name} className="absolute inset-0 z-0 rounded-xl" href={detailUrl} />
        <CardContent className="relative overflow-hidden rounded-t-xl p-0">
          <AspectRatio ratio={8 / 5} className={`flex items-center justify-center ${previewClass(artifact, index)}`}>
            <FileText aria-hidden="true" className="size-9 text-muted-foreground/55" />
            {artifact.readyVersion?.thumbnailState === "ready" ? (
              <img
                alt=""
                className="absolute inset-0 size-full object-cover"
                onError={(event) => { event.currentTarget.hidden = true; }}
                src={`/api/versions/${encodeURIComponent(artifact.readyVersion.id)}/thumbnail`}
              />
            ) : null}
            {previewUrl && artifact.allowedActions.includes("preview") ? <a aria-label={`Preview ${artifact.name}`} className="absolute inset-0 z-10 cursor-pointer" href={previewUrl} target="_blank" /> : null}
            <div className="pointer-events-none absolute top-2 left-2 z-20"><StatusBadge artifact={artifact} overlay /></div>
            <div className="absolute right-2 bottom-2 z-20 flex gap-1.5">
            {ready && (artifact.allowedActions.includes("publish") || artifact.allowedActions.includes("manage_publication")) ? (
              <Tooltip><TooltipTrigger render={<Button aria-label={`${artifact.publicationStatus === "published" ? "Manage publication for" : "Publish"} ${artifact.name}`} className="bg-background/95 shadow-none" size="icon-xs" variant="outline" onClick={onPublication} />}><Rocket aria-hidden="true" /></TooltipTrigger><TooltipContent>{artifact.publicationStatus === "published" ? "Manage publication" : "Publish"}</TooltipContent></Tooltip>
            ) : null}
            </div>
          </AspectRatio>
        </CardContent>
        <CardFooter className="pointer-events-none flex-col items-start gap-0 border-t border-muted px-3 pt-[11px] pb-[13px]">
          <ArtifactCardName name={artifact.name} />
          <span className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">{formatModified(artifact.updatedAt)}</span>
        </CardFooter>
      </Card>
      <div className="absolute top-2 right-2 z-30"><ArtifactMenu artifact={artifact} detailUrl={detailUrl} overlay onRename={onRename} onDelete={onDelete} /></div>
    </li>
  );
}

function ArtifactCardName({ name }: { name: string }) {
  const parts = splitArtifactName(name);
  return (
    <span className="flex w-full min-w-0 items-baseline text-[13px] font-medium" title={name}>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{parts.head}</span>
      <span className="max-w-1/3 shrink-0 overflow-hidden whitespace-nowrap [direction:rtl] [text-align:left]">{parts.tail}</span>
    </span>
  );
}

function splitArtifactName(name: string): { head: string; tail: string } {
  const tailLength = Math.ceil(name.length / 3);
  return { head: name.slice(0, -tailLength), tail: name.slice(-tailLength) };
}

function ArtifactMenu({ artifact, detailUrl, overlay = false, onRename, onDelete }: { artifact: Artifact; detailUrl: string; overlay?: boolean; onRename: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button aria-label={`More actions for ${artifact.name}`} className={overlay ? "bg-background/95 shadow-none" : "bg-white/95 shadow-sm"} size="icon-xs" variant="outline" />}><MoreVertical aria-hidden="true" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => { window.location.href = detailUrl; }}><Info />Info</DropdownMenuItem>
          {artifact.allowedActions.includes("export") && artifact.readyVersion ? <DropdownMenuItem onClick={() => { window.location.href = artifactExportUrl(artifact.readyVersion!.id); }}><Download />Export</DropdownMenuItem> : null}
          {artifact.allowedActions.includes("rename") ? <DropdownMenuItem onClick={onRename}><Pencil />Rename</DropdownMenuItem> : null}
        </DropdownMenuGroup>
        {artifact.allowedActions.includes("delete") ? <><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 />Delete</DropdownMenuItem></DropdownMenuGroup></> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RenameDialog({ artifact, pending, onClose, onSubmit }: { artifact: Artifact | null; pending: boolean; onClose: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState("");
  useEffect(() => setName(artifact?.name ?? ""), [artifact]);
  if (!artifact) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader><DialogTitle>Rename artifact</DialogTitle><DialogDescription>Change the owner-facing name without changing its link.</DialogDescription></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); onSubmit(name); }}>
          <FieldGroup><Field><FieldLabel htmlFor="rename-artifact">Artifact name</FieldLabel><Input id="rename-artifact" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></Field></FieldGroup>
          <DialogFooter className="mt-5"><DialogClose render={<Button type="button" variant="secondary" disabled={pending} />}>Cancel</DialogClose><Button type="submit" disabled={pending || !name.trim()}>{pending ? <Spinner data-icon="inline-start" /> : null}Rename</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ artifact, pending, onClose, onConfirm }: { artifact: Artifact | null; pending: boolean; onClose: () => void; onConfirm: () => void }) {
  if (!artifact) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[396px]">
        <DialogHeader><DialogTitle>Delete artifact?</DialogTitle><DialogDescription>This permanently deletes {artifact.name}, its Share link, Versions, and stored files. This cannot be undone.</DialogDescription></DialogHeader>
        <DialogFooter><DialogClose render={<Button type="button" variant="secondary" disabled={pending} />}>Cancel</DialogClose><Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>{pending ? <Spinner data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}Delete</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ artifact, overlay = false }: { artifact: Artifact; overlay?: boolean }) {
  const publicationLabels = { not_published: "Not published", published: "Published", expired: "Expired", unpublished: "Unpublished" } as const;
  const label = artifact.processingState === "failed" ? "Needs attention" : artifact.processingState === "ready" ? publicationLabels[artifact.publicationStatus] : artifact.processingState === "processing" ? "Processing" : "Accepted";
  return <Badge className={overlay ? "bg-background/95 shadow-none" : "bg-white/95 shadow-sm"} variant="outline">{artifact.publicationStatus === "published" ? <span className="size-1.5 rounded-full bg-[var(--success)]" /> : null}{label}</Badge>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <Empty><EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader></Empty>;
}

function ArtifactGridSkeleton() {
  return <div aria-label="Loading artifacts" className="grid grid-cols-5 gap-3.5">{Array.from({ length: 10 }, (_, index) => <Skeleton key={index} className="h-[194px]" />)}</div>;
}

function artifactFilter(artifact: Artifact): Exclude<ArtifactFilter, "all"> {
  if (artifact.processingState === "failed") return "attention";
  if (artifact.processingState === "accepted" || artifact.processingState === "processing") return "processing";
  if (artifact.publicationStatus === "published") return "published";
  return "ready";
}

function filterLabel(filter: ArtifactFilter): string {
  return { all: "All artifacts", published: "Published", ready: "Ready", processing: "Processing", attention: "Needs attention" }[filter];
}

function previewClass(artifact: Artifact, index: number): string {
  if (artifact.processingState === "failed") return "bg-destructive/5";
  if (artifact.processingState === "accepted" || artifact.processingState === "processing") return "bg-muted";
  return index % 3 === 1 ? "artifact-preview-warm" : index % 3 === 2 ? "artifact-preview-green" : "artifact-preview-cool";
}

function formatModified(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date) : "Recently updated";
}
