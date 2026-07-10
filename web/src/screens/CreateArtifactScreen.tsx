import { FileArchive, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ArtifactApiError, createArtifact, getUploadPolicy, type UploadPolicy } from "../api/artifacts";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export function CreateArtifactScreen({ onAccepted }: { onAccepted: (artifactId: string) => void }) {
  const [policy, setPolicy] = useState<UploadPolicy | null>(null);
  const [policyUnavailable, setPolicyUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    let active = true;
    getUploadPolicy()
      .then((value) => active && setPolicy(value))
      .catch(() => active && setPolicyUnavailable(true));
    return () => {
      active = false;
    };
  }, []);

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
    setUploading(true);
    setProgress(0);
    try {
      const accepted = await createArtifact({
        name,
        file: selectedFile!,
        idempotencyKey: idempotencyKey.current,
        onProgress: setProgress
      });
      onAccepted(accepted.artifactId);
    } catch (reason) {
      setError(uploadErrorMessage(reason));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-7">
      <div>
        <a className="text-sm text-neutral-500 hover:text-neutral-950" href="/artifacts">Back to artifacts</a>
        <h1 className="mt-5 text-2xl font-semibold text-neutral-950">New artifact</h1>
      </div>

      <form className="space-y-6" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor="artifact-name">Artifact name</Label>
          <Input
            id="artifact-name"
            name="name"
            maxLength={120}
            placeholder="Quarterly report"
            disabled={uploading}
            onChange={() => {
              idempotencyKey.current = crypto.randomUUID();
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="artifact-file">ZIP file</Label>
          <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-neutral-300 bg-white px-4 text-center hover:border-neutral-500" htmlFor="artifact-file">
            <FileArchive aria-hidden="true" className="mb-2 size-6 text-neutral-500" />
            <span className="text-sm font-medium text-neutral-900">{selectedFile?.name ?? "Choose a ZIP file"}</span>
            <span className="mt-1 text-xs text-neutral-500">{policy ? `Up to ${formatBytes(policy.maxArchiveBytes)}` : "The server validates all limits"}</span>
          </label>
          <Input
            id="artifact-file"
            name="file"
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            disabled={uploading}
            onChange={(event) => {
              setSelectedFile(event.target.files?.[0] ?? null);
              idempotencyKey.current = crypto.randomUUID();
            }}
          />
        </div>

        {policyUnavailable ? <p className="text-xs text-neutral-500">Upload policy preflight is unavailable. Server validation still applies.</p> : null}
        {error ? <Alert className="border-red-200 bg-red-50 text-red-700">{error}</Alert> : null}
        {progress !== null ? (
          <div aria-label="Upload progress" className="space-y-2">
            <div className="flex justify-between text-xs text-neutral-500"><span>Uploading</span><span>{progress}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-200"><div className="h-full bg-neutral-950 transition-[width]" style={{ width: `${progress}%` }} /></div>
          </div>
        ) : null}
        <Button type="submit" disabled={uploading} className="gap-2">
          <UploadCloud aria-hidden="true" className="size-4" />
          {uploading ? "Uploading..." : "Upload artifact"}
        </Button>
      </form>
    </div>
  );
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
  if (reason instanceof ArtifactApiError && reason.code === "archive_too_large") return "The ZIP exceeds the server upload limit.";
  return reason instanceof Error ? reason.message : "The upload could not be completed.";
}
