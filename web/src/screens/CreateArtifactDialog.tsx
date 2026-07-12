import { FileArchive, Plus, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ArtifactApiError, createArtifact, getUploadPolicy, type UploadPolicy, type ValidationNotice } from "../api/artifacts";
import { preflightArtifactZip } from "../artifacts/archive-preflight-client";
import { ArtifactValidationReport } from "../components/ArtifactValidationReport";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "../components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Progress, ProgressLabel, ProgressValue } from "../components/ui/progress";
import { Spinner } from "../components/ui/spinner";
import { cn } from "../lib/utils";

export function CreateArtifactDialog({ onAccepted }: { onAccepted: (artifactId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<UploadPolicy | null>(null);
  const [policyUnavailable, setPolicyUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preflightIssue, setPreflightIssue] = useState<ValidationNotice | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const preflightController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || policy || policyUnavailable) return;
    let active = true;
    getUploadPolicy()
      .then((value) => active && setPolicy(value))
      .catch(() => active && setPolicyUnavailable(true));
    return () => {
      active = false;
      preflightController.current?.abort();
    };
  }, [open, policy, policyUnavailable]);

  function changeOpen(nextOpen: boolean) {
    if (uploading) return;
    setOpen(nextOpen);
    if (!nextOpen) resetForm();
  }

  function resetForm() {
    formRef.current?.reset();
    setDragging(false);
    setSelectedFile(null);
    setError(null);
    setPreflightIssue(null);
    setProgress(null);
    preflightController.current?.abort();
    preflightController.current = null;
    idempotencyKey.current = crypto.randomUUID();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateCreateInput(selectedFile, policy);
    if (validation) {
      setError(validation);
      return;
    }
    const name = artifactNameFromFile(selectedFile!.name);

    setError(null);
    setPreflightIssue(null);
    setUploading(true);
    try {
      if (policy) {
        const controller = new AbortController();
        preflightController.current = controller;
        try {
          const report = await preflightArtifactZip(selectedFile!, policy, controller.signal);
          if (report.primaryIssue) {
            setPreflightIssue(report.primaryIssue);
            return;
          }
        } catch (reason) {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          setPolicyUnavailable(true);
        } finally {
          preflightController.current = null;
        }
      }
      setProgress(0);
      const accepted = await createArtifact({
        name,
        file: selectedFile!,
        idempotencyKey: idempotencyKey.current,
        onProgress: setProgress
      });
      setOpen(false);
      onAccepted(accepted.artifactId);
    } catch (reason) {
      if (reason instanceof ArtifactApiError && (reason.action || reason.details)) {
        setPreflightIssue({
          code: reason.code,
          message: reason.message,
          action: reason.action ?? null,
          details: reason.details ?? {}
        });
      } else {
        setError(uploadErrorMessage(reason));
      }
    } finally {
      setUploading(false);
    }
  }

  function selectFile(file: File | null) {
    setSelectedFile(file);
    setError(null);
    setPreflightIssue(null);
    idempotencyKey.current = crypto.randomUUID();
  }

  const fileInvalid = Boolean(error);

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={<Button />}>
        <Plus aria-hidden="true" />
        New artifact
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]" showCloseButton={!uploading}>
        <DialogHeader>
          <DialogTitle>New artifact</DialogTitle>
          <DialogDescription>Drop in a ZIP file. Its filename will become the artifact name.</DialogDescription>
        </DialogHeader>

        <form ref={formRef} className="flex flex-col gap-5" onSubmit={submit}>
          <FieldGroup>
            <Field data-invalid={fileInvalid}>
              <FieldLabel htmlFor="artifact-file">ZIP file</FieldLabel>
              <Label
                aria-disabled={uploading}
                className={cn(
                  "flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed bg-muted/40 px-6 text-center transition-[background-color,border-color,box-shadow] hover:border-foreground/30 hover:bg-muted/60",
                  dragging && "border-foreground/40 bg-muted ring-3 ring-ring/20",
                  uploading && "pointer-events-none opacity-50"
                )}
                htmlFor="artifact-file"
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!uploading) setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  if (!uploading) selectFile(event.dataTransfer.files[0] ?? null);
                }}
              >
                <span className="flex size-10 items-center justify-center rounded-lg border bg-background shadow-sm">
                  <FileArchive aria-hidden="true" className="size-5 text-muted-foreground" />
                </span>
                <span className="mt-3 max-w-full truncate text-sm font-medium text-foreground">
                  {selectedFile?.name ?? "Drop a ZIP file here"}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  {selectedFile ? "Choose another file" : "or click to choose"}
                  {policy ? ` · Up to ${formatBytes(policy.maxArchiveBytes)}` : " · The server validates all limits"}
                </span>
              </Label>
              <Input
                id="artifact-file"
                name="file"
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                disabled={uploading}
                aria-invalid={fileInvalid}
                onChange={(event) => {
                  selectFile(event.target.files?.[0] ?? null);
                }}
              />
            </Field>
          </FieldGroup>

          {policyUnavailable ? <Alert><AlertDescription>Upload policy preflight is unavailable. Server validation still applies.</AlertDescription></Alert> : null}
          {preflightIssue ? (
            <ArtifactValidationReport notices={[preflightIssue]} destructive />
          ) : null}
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          {progress !== null ? (
            <Progress aria-label="Upload progress" value={progress}>
              <ProgressLabel>Uploading</ProgressLabel>
              <ProgressValue />
            </Progress>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="secondary" disabled={uploading} />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={uploading}>
              {uploading ? <Spinner aria-hidden="true" role="presentation" data-icon="inline-start" /> : <UploadCloud aria-hidden="true" data-icon="inline-start" />}
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function artifactNameFromFile(fileName: string): string {
  return fileName.replace(/\.zip$/i, "").trim().slice(0, 120);
}

function validateCreateInput(file: File | null, policy: UploadPolicy | null): string | null {
  if (!file || file.size === 0) return "Choose a ZIP file.";
  if (!file.name.toLowerCase().endsWith(".zip")) return "Choose a file with a .zip extension.";
  if (!artifactNameFromFile(file.name)) return "Rename the ZIP file before uploading.";
  if (policy && file.size > policy.maxArchiveBytes) return `This ZIP exceeds the ${formatBytes(policy.maxArchiveBytes)} upload limit.`;
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const sizeInMiB = bytes / 1024 / 1024;
  return `${Number.isInteger(sizeInMiB) ? sizeInMiB : sizeInMiB.toFixed(1)} MiB`;
}

function uploadErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The upload could not be completed.";
}
