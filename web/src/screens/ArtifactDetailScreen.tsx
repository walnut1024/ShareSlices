import { CheckCircle2, Clipboard, Eye, Pencil, RefreshCw, Rocket, Upload, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type Artifact,
  ArtifactApiError,
  type ValidationNotice,
  getArtifact,
  getUploadPolicy,
  publishArtifact,
  replaceArtifactFile,
  retryUploadSession,
  unpublishArtifact,
  updateArtifactName
} from "../api/artifacts";
import { preflightArtifactZip } from "../artifacts/archive-preflight-client";
import { ArtifactStatus } from "../components/ArtifactStatus";
import { ArtifactValidationReport } from "../components/ArtifactValidationReport";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import { Spinner } from "../components/ui/spinner";

type PendingAction = "refresh" | "retry" | "replace_file" | "preview" | "publish" | "unpublish" | "copy_share_link";
type ActionFeedback = { kind: "success" | "error"; message: string };
type IdempotentAction = "retry" | "replace_file" | "publish";

export function ArtifactDetailScreen({
  artifactId,
  onSessionExpired
}: {
  artifactId: string;
  onSessionExpired: () => void;
}) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [preflightWarning, setPreflightWarning] = useState<string | null>(null);
  const [preflightIssue, setPreflightIssue] = useState<ValidationNotice | null>(null);
  const replacementInput = useRef<HTMLInputElement>(null);
  const replacementFingerprint = useRef<string | null>(null);
  const idempotencyKeys = useRef<Partial<Record<IdempotentAction, string>>>({});
  const preflightController = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    getArtifact(artifactId)
      .then((value) => {
        if (active) {
          setArtifact(value);
          setName(value.name);
        }
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof ArtifactApiError && reason.status === 401) {
          onSessionExpired();
          return;
        }
        setError(reason instanceof Error ? reason.message : "Artifact could not be loaded.");
      });
    return () => {
      active = false;
      preflightController.current?.abort();
    };
  }, [artifactId, onSessionExpired]);

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (nextName.length < 1 || nextName.length > 120) {
      setError("Artifact name must contain 1 to 120 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateArtifactName(artifactId, nextName);
      setArtifact(updated);
      setName(updated.name);
      setEditing(false);
    } catch (reason) {
      handleRequestError(reason, "The name could not be updated.", setError, onSessionExpired);
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    setPendingAction("refresh");
    setActionFeedback(null);
    try {
      const updated = await getArtifact(artifactId);
      setArtifact(updated);
      setName(updated.name);
      setActionFeedback({ kind: "success", message: "Status refreshed." });
    } catch (reason) {
      handleActionError(reason, "The status could not be refreshed.");
    } finally {
      setPendingAction(null);
    }
  }

  async function retry() {
    if (!artifact?.uploadSessionId) {
      setActionFeedback({ kind: "error", message: "The failed upload session is unavailable. Refresh and try again." });
      return;
    }
    await runMutation("retry", "Retry queued.", async () => {
      await retryUploadSession(artifact.uploadSessionId!, idempotencyKey("retry"));
    });
  }

  async function replaceFile(file: File) {
    if (file.size === 0 || !file.name.toLowerCase().endsWith(".zip")) {
      setActionFeedback({ kind: "error", message: "Choose a non-empty file with a .zip extension." });
      return;
    }
    const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
    if (replacementFingerprint.current !== fingerprint) {
      replacementFingerprint.current = fingerprint;
      idempotencyKeys.current.replace_file = crypto.randomUUID();
    }
    setPendingAction("replace_file");
    setActionFeedback(null);
    setPreflightWarning(null);
    setPreflightIssue(null);
    try {
      const policy = await getUploadPolicy();
      const controller = new AbortController();
      preflightController.current = controller;
      const report = await preflightArtifactZip(file, policy, controller.signal);
      if (report.primaryIssue) {
        setPreflightIssue(report.primaryIssue);
        return;
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setPreflightWarning("ZIP preflight is unavailable. Server validation still applies.");
    } finally {
      preflightController.current = null;
      setPendingAction(null);
    }
    await runMutation("replace_file", "Replacement uploaded and queued.", async () => {
      await replaceArtifactFile(artifactId, file, idempotencyKey("replace_file"));
    });
  }

  async function preview() {
    if (!artifact?.readyVersion) return;
    setPendingAction("preview");
    setActionFeedback(null);
    await Promise.resolve();
    try {
      const previewWindow = window.open(previewUrl(artifact.readyVersion.id), "_blank");
      if (!previewWindow) throw new Error("Preview was blocked by the browser.");
      previewWindow.opener = null;
      setActionFeedback({ kind: "success", message: "Preview opened in a new tab." });
    } catch (reason) {
      setActionFeedback({ kind: "error", message: reason instanceof Error ? reason.message : "Preview could not be opened." });
    } finally {
      setPendingAction(null);
    }
  }

  async function publish() {
    if (!artifact?.readyVersion) return;
    await runMutation("publish", "Artifact published.", async () => {
      await publishArtifact(artifactId, artifact.readyVersion!.id, idempotencyKey("publish"));
    });
  }

  async function unpublish() {
    if (!artifact?.publication) return;
    await runMutation("unpublish", "Artifact unpublished. The Share link is unchanged.", async () => {
      await unpublishArtifact(artifactId, artifact.publication!.id);
    });
  }

  async function copyShareLink() {
    if (!artifact) return;
    setPendingAction("copy_share_link");
    setActionFeedback(null);
    try {
      await navigator.clipboard.writeText(artifact.shareLink.url);
      setActionFeedback({ kind: "success", message: "Share link copied." });
    } catch {
      setActionFeedback({ kind: "error", message: "The Share link could not be copied." });
    } finally {
      setPendingAction(null);
    }
  }

  async function runMutation(action: PendingAction, successMessage: string, mutation: () => Promise<void>) {
    setPendingAction(action);
    setActionFeedback(null);
    try {
      await mutation();
      const updated = await getArtifact(artifactId);
      setArtifact(updated);
      setName(updated.name);
      setActionFeedback({ kind: "success", message: successMessage });
      if (action === "retry" || action === "replace_file" || action === "publish") {
        delete idempotencyKeys.current[action];
      }
      if (action === "replace_file") replacementFingerprint.current = null;
    } catch (reason) {
      handleActionError(reason, "The action could not be completed.");
    } finally {
      setPendingAction(null);
    }
  }

  function handleActionError(reason: unknown, fallback: string) {
    if (reason instanceof ArtifactApiError && reason.status === 401) {
      onSessionExpired();
      return;
    }
    if (reason instanceof ArtifactApiError && (reason.action || reason.details)) {
      setPreflightIssue({
        code: reason.code,
        message: reason.message,
        action: reason.action ?? null,
        details: reason.details ?? {}
      });
      return;
    }
    setActionFeedback({ kind: "error", message: reason instanceof Error ? reason.message : fallback });
  }

  function idempotencyKey(action: IdempotentAction): string {
    const existing = idempotencyKeys.current[action];
    if (existing) return existing;
    const created = crypto.randomUUID();
    idempotencyKeys.current[action] = created;
    return created;
  }

  if (error && !artifact) {
    return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
  }
  if (!artifact) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading artifact...</div>;
  }

  const actionPending = pendingAction !== null;

  return (
    <div className="flex flex-col gap-8">
      <a className="text-sm text-neutral-500 hover:text-neutral-950" href="/artifacts">
        Back to artifacts
      </a>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="break-words text-2xl font-semibold text-neutral-950">{artifact.name}</h1>
            <ArtifactStatus artifact={artifact} />
          </div>
          <p className="mt-2 break-all font-mono text-xs text-neutral-500">{artifact.id}</p>
        </div>
        {artifact.allowedActions.includes("rename") ? (
          <Button
            variant="secondary"
            disabled={actionPending}
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden="true" data-icon="inline-start" />
            Rename
          </Button>
        ) : null}
      </header>
      <Separator />

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {editing ? (
        <form className="max-w-xl" onSubmit={saveName}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="artifact-name">Artifact name</FieldLabel>
              <div className="flex gap-2">
                <Input id="artifact-name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
                <Button type="submit" disabled={saving}>{saving ? <><Spinner aria-hidden="true" role="presentation" data-icon="inline-start" />Saving...</> : "Save name"}</Button>
                <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </Field>
          </FieldGroup>
        </form>
      ) : null}

      <section aria-labelledby="artifact-state" className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="artifact-state" className="text-sm font-semibold text-neutral-950">Current state</h2>
            {artifact.processingState === "accepted" || artifact.processingState === "processing" ? (
              <Button
                type="button"
                variant="secondary"
                disabled={actionPending}
                onClick={refresh}
              >
                {pendingAction === "refresh" ? <Spinner aria-hidden="true" role="presentation" data-icon="inline-start" /> : <RefreshCw aria-hidden="true" data-icon="inline-start" />}
                {pendingAction === "refresh" ? "Refreshing..." : "Refresh status"}
              </Button>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-6 text-neutral-600">{stateDescription(artifact)}</p>
          {artifact.validationReport?.primaryIssue ? (
            <div className="mt-4">
              <ArtifactValidationReport notices={[artifact.validationReport.primaryIssue, ...artifact.validationReport.issues]} destructive />
            </div>
          ) : artifact.failure ? (
            <Alert className="mt-4" variant="destructive">
              <AlertTitle>{artifact.failure.message}</AlertTitle>
              <AlertDescription>
                <span>{failureAction(artifact)}</span>
                <span className="mt-2 block font-mono text-xs">{artifact.failure.code}</span>
              </AlertDescription>
            </Alert>
          ) : null}
          {artifact.validationReport?.warnings.length ? (
            <div className="mt-4">
              <ArtifactValidationReport notices={artifact.validationReport.warnings} />
            </div>
          ) : null}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-neutral-500">Share link</dt>
          <dd className="min-w-0 truncate text-right text-neutral-900">{artifact.shareLink.url}</dd>
          <dt className="text-neutral-500">Link state</dt>
          <dd className="text-right capitalize text-neutral-900">{artifact.shareLink.state}</dd>
          <dt className="text-neutral-500">Version</dt>
          <dd className="truncate text-right font-mono text-xs text-neutral-900">{artifact.readyVersion?.id ?? "Not ready"}</dd>
        </dl>
      </section>
      <Separator />

      <section aria-labelledby="artifact-actions" aria-busy={actionPending}>
        <h2 id="artifact-actions" className="text-sm font-semibold text-neutral-950">Actions</h2>
        <div className="mt-3 flex min-h-10 flex-wrap gap-2">
          {artifact.allowedActions.includes("retry") ? (
            <ActionButton
              icon={RefreshCw}
              label={pendingAction === "retry" ? "Retrying..." : "Retry"}
              pending={pendingAction === "retry"}
              disabled={actionPending}
              onClick={retry}
            />
          ) : null}
          {artifact.allowedActions.includes("replace_file") ? (
            <>
              <Input
                ref={replacementInput}
                aria-label="Replacement ZIP"
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                disabled={actionPending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void replaceFile(file);
                }}
              />
              <ActionButton
                icon={Upload}
                label={pendingAction === "replace_file" ? "Uploading..." : "Replace file"}
                pending={pendingAction === "replace_file"}
                disabled={actionPending}
                onClick={() => replacementInput.current?.click()}
              />
            </>
          ) : null}
          {artifact.allowedActions.includes("preview") ? (
            <ActionButton
              icon={Eye}
              label={pendingAction === "preview" ? "Opening..." : "Preview"}
              pending={pendingAction === "preview"}
              disabled={actionPending}
              onClick={preview}
            />
          ) : null}
          {artifact.allowedActions.includes("publish") ? (
            <ActionButton
              icon={Rocket}
              label={pendingAction === "publish" ? "Publishing..." : "Publish"}
              pending={pendingAction === "publish"}
              disabled={actionPending}
              onClick={publish}
            />
          ) : null}
          {artifact.allowedActions.includes("unpublish") ? (
            <ActionButton
              icon={XCircle}
              label={pendingAction === "unpublish" ? "Removing publication..." : "Unpublish"}
              pending={pendingAction === "unpublish"}
              disabled={actionPending}
              onClick={unpublish}
            />
          ) : null}
          {artifact.allowedActions.includes("copy_share_link") ? (
            <ActionButton
              icon={Clipboard}
              label={pendingAction === "copy_share_link" ? "Copying..." : "Copy Share link"}
              pending={pendingAction === "copy_share_link"}
              disabled={actionPending}
              onClick={copyShareLink}
            />
          ) : null}
        </div>
        <div className="mt-3 min-h-10" aria-live="polite">
          {actionFeedback?.kind === "error" ? (
            <Alert variant="destructive"><AlertDescription>{actionFeedback.message}</AlertDescription></Alert>
          ) : actionFeedback ? (
            <Alert role="status">
              <CheckCircle2 aria-hidden="true" />
              <AlertDescription>{actionFeedback.message}</AlertDescription>
            </Alert>
          ) : null}
          {preflightIssue ? (
            <ArtifactValidationReport notices={[preflightIssue]} destructive />
          ) : null}
          {preflightWarning ? <Alert><AlertDescription>{preflightWarning}</AlertDescription></Alert> : null}
        </div>
      </section>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  pending,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: typeof Eye; label: string; pending: boolean }) {
  return (
    <Button {...props} type="button" variant="secondary">
      {pending ? <Spinner aria-hidden="true" role="presentation" data-icon="inline-start" /> : <Icon aria-hidden="true" data-icon="inline-start" />}
      {label}
    </Button>
  );
}

function previewUrl(versionId: string): string {
  return `/api/versions/${encodeURIComponent(versionId)}/content/`;
}

function failureAction(artifact: Artifact): string {
  return artifact.failure?.recoverable
    ? "Retry processes the same ZIP again."
    : "Replace the file with a corrected ZIP to continue.";
}

function stateDescription(artifact: Artifact): string {
  if (artifact.processingState === "accepted") return "The upload was accepted and is waiting for processing.";
  if (artifact.processingState === "processing") return "The uploaded files are being validated and prepared.";
  if (artifact.processingState === "failed") return "Processing stopped. Use the available recovery action to continue.";
  if (artifact.publication) return "This artifact is published at its active Share link.";
  return "The artifact is ready and has not been published.";
}

function handleRequestError(
  reason: unknown,
  fallback: string,
  setError: (message: string) => void,
  onSessionExpired: () => void
) {
  if (reason instanceof ArtifactApiError && reason.status === 401) {
    onSessionExpired();
    return;
  }
  setError(reason instanceof Error ? reason.message : fallback);
}
