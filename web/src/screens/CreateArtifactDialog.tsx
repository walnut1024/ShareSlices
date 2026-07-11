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

export function CreateArtifactDialog({ onAccepted }: { onAccepted: (artifactId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<UploadPolicy | null>(null);
  const [policyUnavailable, setPolicyUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preflightIssue, setPreflightIssue] = useState<ValidationNotice | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
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
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const validation = validateCreateInput(name, selectedFile, policy);
    if (validation) {
      setError(validation);
      return;
    }

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

  const nameInvalid = error?.startsWith("Artifact name") ?? false;
  const fileInvalid = Boolean(error) && !nameInvalid;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={<Button />}>
        <Plus aria-hidden="true" />
        New artifact
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]" showCloseButton={!uploading}>
        <DialogHeader>
          <DialogTitle>New artifact</DialogTitle>
          <DialogDescription>Name your artifact and choose a ZIP file to upload.</DialogDescription>
        </DialogHeader>

        <form ref={formRef} className="flex flex-col gap-5" onSubmit={submit}>
          <FieldGroup className="gap-4">
            <Field data-invalid={nameInvalid}>
              <FieldLabel htmlFor="artifact-name">Artifact name</FieldLabel>
              <Input
                ref={nameInputRef}
                id="artifact-name"
                name="name"
                maxLength={120}
                placeholder="Quarterly report"
                disabled={uploading}
                aria-invalid={nameInvalid}
                onChange={() => {
                  setError(null);
                  idempotencyKey.current = crypto.randomUUID();
                }}
              />
            </Field>
            <Field data-invalid={fileInvalid}>
              <FieldLabel htmlFor="artifact-file">ZIP file</FieldLabel>
              <Label
                className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 text-center transition-colors hover:border-neutral-500 hover:bg-white"
                htmlFor="artifact-file"
              >
                <FileArchive aria-hidden="true" className="size-7 text-neutral-400" />
                <span className="mt-2 max-w-full truncate text-sm font-medium text-neutral-950">
                  {selectedFile?.name ?? "Choose a ZIP file"}
                </span>
                <span className="mt-1 text-xs text-neutral-500">
                  {policy ? `Up to ${formatBytes(policy.maxArchiveBytes)}` : "The server validates all limits"}
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
                  const file = event.target.files?.[0] ?? null;
                  setSelectedFile(file);
                  if (file && nameInputRef.current && !nameInputRef.current.value.trim()) {
                    const inferredName = artifactNameFromFile(file.name);
                    if (inferredName) nameInputRef.current.value = inferredName;
                  }
                  setError(null);
                  idempotencyKey.current = crypto.randomUUID();
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

function validateCreateInput(name: string, file: File | null, policy: UploadPolicy | null): string | null {
  if (name.length < 1 || name.length > 120) return "Artifact name must contain 1 to 120 characters.";
  if (!file || file.size === 0) return "Choose a ZIP file.";
  if (!file.name.toLowerCase().endsWith(".zip")) return "Choose a file with a .zip extension.";
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
