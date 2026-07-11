import { Check, Copy, Eye, Link2, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type Artifact,
  getArtifact,
  publishArtifact,
  updateShareLinkExpiration
} from "../api/artifacts";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";

type ExpirationMode = "permanent" | "date";

export function ArtifactShareDialog({
  artifact,
  onOpenChange,
  onUpdated
}: {
  artifact: Artifact | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: (artifact: Artifact) => void;
}) {
  const [mode, setMode] = useState<ExpirationMode>("permanent");
  const [date, setDate] = useState("");
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!artifact) return;
    setMode(artifact.shareLink.expiresAt ? "date" : "permanent");
    setDate(artifact.shareLink.expiresAt?.slice(0, 10) ?? tomorrow());
    setCopied(false);
    setError(null);
  }, [artifact]);

  if (!artifact) return null;
  const published = artifact.publication !== null;

  async function save() {
    if (!artifact) return;
    const expiresAt = mode === "permanent" ? null : expirationFromDate(date);
    if (mode === "date" && !expiresAt) {
      setError("Choose a future expiration date.");
      return;
    }
    if (!published && !artifact.readyVersion) {
      setError("The artifact must be ready before it can be shared.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await updateShareLinkExpiration(artifact.id, expiresAt);
      if (!published) {
        await publishArtifact(artifact.id, artifact.readyVersion!.id, crypto.randomUUID());
      }
      const updated = await getArtifact(artifact.id);
      onUpdated(updated);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Share settings could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!artifact) return;
    try {
      await navigator.clipboard.writeText(artifact.shareLink.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("The Share link could not be copied.");
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 sm:max-w-[440px]" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{published ? "Manage share" : "Share artifact"}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            {published ? <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--success)]" /> : null}
            {published ? "Link active" : "Anyone with the link · Can view"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 gap-2">
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-muted/50 px-2.5">
            <Link2 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono text-xs text-foreground">{artifact.shareLink.url}</span>
          </div>
          <Button type="button" onClick={() => void copy()}>
            {copied ? <Check aria-hidden="true" data-icon="inline-start" /> : <Copy aria-hidden="true" data-icon="inline-start" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5">
          <Eye aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="flex-1 text-sm font-medium">Anyone with the link</span>
          <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium">
            <LockKeyhole aria-hidden="true" className="size-3" />Can view
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">Link expiration</span>
          <ToggleGroup
            aria-label="Link expiration"
            value={[mode]}
            onValueChange={(value) => {
              const next = value[0] as ExpirationMode | undefined;
              if (next) setMode(next);
            }}
          >
            <ToggleGroupItem value="permanent">Permanent</ToggleGroupItem>
            <ToggleGroupItem value="date">Set date</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {mode === "date" ? (
          <Input aria-label="Expiration date" min={tomorrow()} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        ) : null}
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="secondary" disabled={pending} />}>Cancel</DialogClose>
          <Button type="button" disabled={pending} onClick={() => void save()}>
            {pending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
            {published ? "Done" : "Create link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function expirationFromDate(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isFinite(date.getTime()) && date > new Date() ? date.toISOString() : null;
}
