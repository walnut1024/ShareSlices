import { Check, Copy, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type Artifact,
  ArtifactApiError,
  getArtifact,
  publishArtifact,
  unpublishArtifact,
  updatePublicationExpiration
} from "../api/artifacts";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Field, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";

type ExpirationMode = "permanent" | "7d" | "30d" | "custom";

export function ArtifactShareDialog({ artifact, mode, onOpenChange, onUpdated, onSessionExpired }: {
  artifact: Artifact | null;
  mode: "publish" | "manage";
  onOpenChange: (open: boolean) => void;
  onUpdated: (artifact: Artifact) => void;
  onSessionExpired?: () => void;
}) {
  const [expiration, setExpiration] = useState<ExpirationMode>("permanent");
  const [customExpiration, setCustomExpiration] = useState("");
  const [replaceLink, setReplaceLink] = useState(false);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!artifact) return;
    const policy = artifact.publication?.expirationKind;
    const seconds = artifact.publication?.durationSeconds;
    setExpiration(policy === "duration" && seconds === 604800 ? "7d" : policy === "duration" && seconds === 2592000 ? "30d" : policy === "exact" ? "custom" : "permanent");
    setCustomExpiration(toLocalDateTime(artifact.publication?.expiresAt));
    setReplaceLink(false);
    setConfirmReplacement(false);
    setCopied(false);
    setError(null);
  }, [artifact, mode]);

  if (!artifact) return null;

  async function submit() {
    if (!artifact) return;
    const exactExpiration = expiration === "custom" ? futureIso(customExpiration) : null;
    if (expiration === "custom" && !exactExpiration) {
      setError("Choose a future expiration date and time. Use Unpublish to end access now.");
      return;
    }
    if (replaceLink && !confirmReplacement) {
      setError("Confirm that the previous link will permanently stop working.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (mode === "manage") {
        if (!artifact.publication) throw new Error("There is no publication to manage.");
        await updatePublicationExpiration(artifact.id, artifact.publication.id, expiration === "permanent" ? { kind: "permanent" } : { kind: "exact", expiresAt: exactExpiration ?? relativeExpiration(expiration)! });
      } else {
        const versionId = artifact.readyVersion?.id ?? artifact.publication?.versionId;
        await publishArtifact(artifact.id, {
          ...(versionId ? { versionId } : {}),
          expiration: expiration === "permanent" ? { kind: "permanent" } : expiration === "custom" ? { kind: "exact", expiresAt: exactExpiration! } : { kind: "duration", durationSeconds: expiration === "7d" ? 604800 : 2592000 },
          link: replaceLink ? { mode: "replace", confirmRetire: true } : { mode: "reuse" }
        }, crypto.randomUUID());
      }
      onUpdated(await getArtifact(artifact.id));
      onOpenChange(false);
    } catch (reason) {
      if (reason instanceof ArtifactApiError && reason.status === 401) {
        onSessionExpired?.();
        return;
      }
      setError(reason instanceof Error ? reason.message : "Publication settings could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!artifact?.shareLink || artifact.publicationStatus !== "published") return;
    try {
      await navigator.clipboard.writeText(artifact.shareLink.url);
      setCopied(true);
    } catch {
      setError("The Share link could not be copied.");
    }
  }

  async function unpublish() {
    if (!artifact?.publication) return;
    setPending(true);
    setError(null);
    try {
      await unpublishArtifact(artifact.id, artifact.publication.id);
      onUpdated(await getArtifact(artifact.id));
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The publication could not be ended.");
    } finally {
      setPending(false);
    }
  }

  const managing = mode === "manage";
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 sm:max-w-[480px]" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{managing ? "Manage publication" : artifact.publicationStatus === "not_published" ? "Publish artifact" : "Publish again"}</DialogTitle>
          <DialogDescription>{managing ? "Update access without publishing another Version." : "Make this artifact available to anyone with its Share link."}</DialogDescription>
        </DialogHeader>

        {managing && artifact.shareLink ? <div className="flex min-w-0 gap-2"><div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-muted/50 px-2.5"><Link2 className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate font-mono text-xs">{artifact.shareLink.url}</span></div><Button type="button" disabled={artifact.publicationStatus !== "published"} onClick={() => void copy()}>{copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copied ? "Copied" : "Copy"}</Button></div> : null}

        <Field><FieldLabel htmlFor="publication-expiration">Publication expiration</FieldLabel><select id="publication-expiration" className="h-9 rounded-md border bg-transparent px-3 text-sm" value={expiration} onChange={(event) => setExpiration(event.target.value as ExpirationMode)}><option value="permanent">Permanent</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="custom">Custom date and time</option></select></Field>
        {expiration === "custom" ? <Input aria-label="Expiration date and time" type="datetime-local" value={customExpiration} onChange={(event) => setCustomExpiration(event.target.value)} /> : null}

        {!managing && artifact.shareLink ? <div className="rounded-lg border p-3"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={replaceLink} onChange={(event) => { setReplaceLink(event.target.checked); setConfirmReplacement(false); }} />Generate a new Share link</label>{replaceLink ? <label className="mt-3 flex items-start gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={confirmReplacement} onChange={(event) => setConfirmReplacement(event.target.checked)} />I understand the previous link will permanently stop working.</label> : null}</div> : null}
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

        <DialogFooter className="justify-between sm:justify-between">
          {managing ? <Button type="button" variant="destructive" disabled={pending} onClick={() => void unpublish()}>Unpublish</Button> : <span />}
          <div className="flex gap-2"><DialogClose render={<Button type="button" variant="secondary" disabled={pending} />}>Cancel</DialogClose><Button type="button" disabled={pending} onClick={() => void submit()}>{pending ? <Spinner data-icon="inline-start" /> : null}{managing ? "Save" : "Publish"}</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function futureIso(value: string): string | null {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) && date > new Date() ? date.toISOString() : null;
}

function toLocalDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function relativeExpiration(mode: ExpirationMode): string | null {
  if (mode !== "7d" && mode !== "30d") return null;
  return new Date(Date.now() + (mode === "7d" ? 7 : 30) * 86400000).toISOString();
}
