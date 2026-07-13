import { format } from "date-fns";
import { CalendarDays, Check, Copy, Link2 } from "lucide-react";
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
import { Calendar } from "../components/ui/calendar";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Spinner } from "../components/ui/spinner";

type ExpirationMode = "permanent" | "7d" | "30d" | "custom";
const expirationOptions = [
  { label: "Permanent", value: "permanent" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "Custom date and time", value: "custom" }
] satisfies { label: string; value: ExpirationMode }[];

export function ArtifactShareDialog({ artifact, mode, onOpenChange, onUpdated, onSessionExpired }: {
  artifact: Artifact | null;
  mode: "publish" | "manage";
  onOpenChange: (open: boolean) => void;
  onUpdated: (artifact: Artifact) => void;
  onSessionExpired?: () => void;
}) {
  const [dialogArtifact, setDialogArtifact] = useState<Artifact | null>(artifact);
  const [publishedInDialog, setPublishedInDialog] = useState(false);
  const [expiration, setExpiration] = useState<ExpirationMode>("permanent");
  const [customExpiration, setCustomExpiration] = useState("");
  const [replaceLink, setReplaceLink] = useState(false);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!artifact) {
      setDialogArtifact(null);
      setPublishedInDialog(false);
      return;
    }
    setDialogArtifact(artifact);
    setPublishedInDialog((current) => current && artifact.publicationStatus === "published");
    const policy = artifact.publication?.expirationKind;
    const seconds = artifact.publication?.durationSeconds;
    setExpiration(policy === "duration" && seconds === 604800 ? "7d" : policy === "duration" && seconds === 2592000 ? "30d" : policy === "exact" ? "custom" : "permanent");
    setCustomExpiration(toLocalDateTime(artifact.publication?.expiresAt));
    setReplaceLink(false);
    setConfirmReplacement(false);
    setCopied(false);
    setError(null);
  }, [artifact, mode]);

  if (!dialogArtifact) return null;

  async function submit() {
    if (!dialogArtifact) return;
    const current = dialogArtifact;
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
      if (mode === "manage" || publishedInDialog) {
        if (!current.publication) throw new Error("There is no publication to manage.");
        await updatePublicationExpiration(current.id, current.publication.id, expiration === "permanent" ? { kind: "permanent" } : { kind: "exact", expiresAt: exactExpiration ?? relativeExpiration(expiration)! });
      } else {
        const versionId = current.readyVersion?.id ?? current.publication?.versionId;
        await publishArtifact(current.id, {
          ...(versionId ? { versionId } : {}),
          expiration: expiration === "permanent" ? { kind: "permanent" } : expiration === "custom" ? { kind: "exact", expiresAt: exactExpiration! } : { kind: "duration", durationSeconds: expiration === "7d" ? 604800 : 2592000 },
          link: replaceLink ? { mode: "replace", confirmRetire: true } : { mode: "reuse" }
        }, crypto.randomUUID());
      }
      const updated = await getArtifact(current.id);
      setDialogArtifact(updated);
      setPublishedInDialog(true);
      onUpdated(updated);
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
    const current = dialogArtifact;
    if (!current?.shareLink || current.publicationStatus !== "published") return;
    const shareUrl = current.shareLink.url;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setError("The Share link could not be copied.");
    }
  }

  async function unpublish() {
    const current = dialogArtifact;
    if (!current?.publication) return;
    const publicationId = current.publication.id;
    setPending(true);
    setError(null);
    try {
      await unpublishArtifact(current.id, publicationId);
      onUpdated(await getArtifact(current.id));
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The publication could not be ended.");
    } finally {
      setPending(false);
    }
  }

  const managing = mode === "manage" || publishedInDialog;
  const shareLink = dialogArtifact.shareLink?.url ?? "Available after publishing";
  const canCopy = dialogArtifact.publicationStatus === "published" && dialogArtifact.shareLink !== null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 sm:max-w-[480px]" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{publishedInDialog ? "Artifact published" : managing ? "Manage publication" : dialogArtifact.publicationStatus === "not_published" ? "Publish artifact" : "Publish again"}</DialogTitle>
          <DialogDescription>{publishedInDialog ? "The Share link is ready to copy. You can also adjust when access ends." : managing ? "Update access without publishing another Version." : "Choose an access period, then publish and copy the Share link here."}</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="share-link">Share link</FieldLabel>
            <InputGroup>
              <InputGroupAddon><Link2 /></InputGroupAddon>
              <InputGroupInput id="share-link" className="font-mono text-xs" readOnly value={shareLink} />
              <InputGroupAddon align="inline-end"><InputGroupButton aria-label="Copy Share link" disabled={!canCopy} onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</InputGroupButton></InputGroupAddon>
            </InputGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="publication-expiration">Access period</FieldLabel>
            <Select items={expirationOptions} value={expiration} onValueChange={(value) => setExpiration(value as ExpirationMode)}>
              <SelectTrigger id="publication-expiration" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>{expirationOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {expiration === "custom" ? <CustomExpirationPicker value={customExpiration} onChange={setCustomExpiration} /> : null}
        </FieldGroup>

        {!managing && dialogArtifact.shareLink ? (
          <div className="rounded-lg border p-3">
            <FieldGroup className="gap-3">
              <Field orientation="horizontal">
                <Checkbox id="replace-share-link" checked={replaceLink} onCheckedChange={(checked) => { setReplaceLink(checked); setConfirmReplacement(false); }} />
                <FieldLabel htmlFor="replace-share-link">Generate a new Share link</FieldLabel>
              </Field>
              {replaceLink ? (
                <Field orientation="horizontal" className="items-start">
                  <Checkbox id="confirm-share-link-replacement" checked={confirmReplacement} onCheckedChange={setConfirmReplacement} />
                  <FieldLabel htmlFor="confirm-share-link-replacement" className="font-normal text-muted-foreground">I understand the previous link will permanently stop working.</FieldLabel>
                </Field>
              ) : null}
            </FieldGroup>
          </div>
        ) : null}
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

        <DialogFooter className="justify-between sm:justify-between">
          {managing ? <Button type="button" variant="destructive" disabled={pending} onClick={() => void unpublish()}>Unpublish</Button> : <span />}
          <div className="flex gap-2">{!managing ? <DialogClose render={<Button type="button" variant="secondary" disabled={pending} />}>Cancel</DialogClose> : null}<Button type="button" disabled={pending} onClick={() => void submit()}>{pending ? <Spinner data-icon="inline-start" /> : null}{managing ? "Save" : "Publish"}</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomExpirationPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = localDate(value);
  return (
    <Field>
      <FieldLabel>Custom expiration</FieldLabel>
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <Popover>
          <PopoverTrigger render={<Button type="button" variant="outline" className="justify-start font-normal" />}>
            <CalendarDays data-icon="inline-start" />{selected ? format(selected, "MMM d, yyyy") : "Choose date"}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar mode="single" selected={selected ?? undefined} disabled={{ before: startOfToday() }} onSelect={(date) => date && onChange(withDate(value, date))} />
          </PopoverContent>
        </Popover>
        <Input aria-label="Expiration time" type="time" value={value.slice(11, 16)} onChange={(event) => onChange(withTime(value, event.target.value))} />
      </div>
    </Field>
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

function localDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function withDate(value: string, date: Date): string {
  const time = value.slice(11, 16) || "23:59";
  return `${format(date, "yyyy-MM-dd")}T${time}`;
}

function withTime(value: string, time: string): string {
  const date = value.slice(0, 10) || format(new Date(), "yyyy-MM-dd");
  return `${date}T${time}`;
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function relativeExpiration(mode: ExpirationMode): string | null {
  if (mode !== "7d" && mode !== "30d") return null;
  return new Date(Date.now() + (mode === "7d" ? 7 : 30) * 86400000).toISOString();
}
