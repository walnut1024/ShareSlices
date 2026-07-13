export type ArtifactAction =
  | "rename"
  | "retry"
  | "replace_file"
  | "preview"
  | "publish"
  | "manage_publication"
  | "unpublish"
  | "copy_share_link"
  | "export"
  | "delete";

export type Artifact = {
  id: string;
  name: string;
  updatedAt: string;
  uploadSessionId: string | null;
  processingState: "accepted" | "processing" | "ready" | "failed";
  shareLink: { url: string; state: "active" | "retired" } | null;
  readyVersion: { id: string; state: "ready"; thumbnailState?: "pending" | "ready" | "failed" } | null;
  publicationStatus: "not_published" | "published" | "expired" | "unpublished";
  publication: {
    id: string;
    versionId: string;
    publishedAt: string;
    expirationKind: "permanent" | "duration" | "exact";
    durationSeconds: number | null;
    expiresAt: string | null;
    endedAt: string | null;
    endReason: "unpublished" | "superseded" | null;
  } | null;
  failure: { code: string; message: string; recoverable: boolean } | null;
  validationReport: ValidationReport | null;
  allowedActions: ArtifactAction[];
};

export type ValidationDetails = {
  path?: string;
  paths?: string[];
  candidates?: string[];
  extension?: string;
  validationKind?: string;
  actualBytes?: number | string;
  limitBytes?: number | string;
  actualCount?: number | string;
  limitCount?: number | string;
  ignoredCount?: number | string;
  directory?: string;
  entryFile?: string;
};

export type ValidationNotice = {
  code: string;
  message: string;
  action: string | null;
  details: ValidationDetails;
};

export type ValidationReport = {
  primaryIssue: ValidationNotice | null;
  issues: ValidationNotice[];
  warnings: ValidationNotice[];
};

export type UploadPolicy = {
  revision: string;
  maxArchiveBytes: number;
  maxExpandedBytes: number;
  maxFileCount: number;
  maxFileBytes: number;
  enabledExtensions: string[];
};

export type ArtifactAccepted = {
  artifactId: string;
  uploadSessionId: string;
  processingState: "accepted";
  shareLink: Artifact["shareLink"];
};

type ErrorResponse = {
  error?: { code?: string; message?: string; action?: string; details?: ValidationDetails };
};

export class ArtifactApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly action?: string,
    public readonly details?: ValidationDetails
  ) {
    super(message);
    this.name = "ArtifactApiError";
  }
}

async function responseError(response: Response): Promise<ArtifactApiError> {
  const body = (await response.json().catch(() => null)) as ErrorResponse | null;
  return new ArtifactApiError(
    body?.error?.message ?? "The request could not be completed.",
    body?.error?.code ?? "request_failed",
    response.status,
    body?.error?.action,
    body?.error?.details
  );
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "include", ...init });
  if (!response.ok) {
    throw await responseError(response);
  }
  return (await response.json()) as T;
}

async function requestWithoutBody(path: string, init: RequestInit): Promise<void> {
  const response = await fetch(path, { credentials: "include", ...init });
  if (!response.ok) {
    throw await responseError(response);
  }
}

export async function getUploadPolicy(): Promise<UploadPolicy> {
  const response = await request<{ policy: UploadPolicy }>("/api/artifact-upload-policies/current");
  return response.policy;
}

export async function listArtifacts(): Promise<Artifact[]> {
  const response = await request<{ artifacts: Artifact[] }>("/api/artifacts");
  return response.artifacts;
}

export async function getArtifact(artifactId: string): Promise<Artifact> {
  const response = await request<{ artifact: Artifact }>(`/api/artifacts/${encodeURIComponent(artifactId)}`);
  return response.artifact;
}

export async function updateArtifactName(artifactId: string, name: string): Promise<Artifact> {
  const response = await request<{ artifact: Artifact }>(`/api/artifacts/${encodeURIComponent(artifactId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
  return response.artifact;
}

export async function updatePublicationExpiration(
  artifactId: string,
  publicationId: string,
  expiration: { kind: "permanent" } | { kind: "exact"; expiresAt: string }
): Promise<Artifact> {
  const response = await request<{ artifact: Artifact }>(`/api/artifacts/${encodeURIComponent(artifactId)}/publications/${encodeURIComponent(publicationId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expiration })
  });
  return response.artifact;
}

export async function deleteArtifact(artifactId: string): Promise<void> {
  await requestWithoutBody(`/api/artifacts/${encodeURIComponent(artifactId)}`, { method: "DELETE" });
}

export function artifactExportUrl(versionId: string): string {
  return `/api/versions/${encodeURIComponent(versionId)}/export`;
}

export async function retryUploadSession(uploadSessionId: string, idempotencyKey: string): Promise<ArtifactAccepted> {
  return request<ArtifactAccepted>(`/api/upload-sessions/${encodeURIComponent(uploadSessionId)}:retry`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey }
  });
}

export async function replaceArtifactFile(
  artifactId: string,
  file: File,
  idempotencyKey: string
): Promise<ArtifactAccepted> {
  const body = new FormData();
  body.set("file", file);
  return request<ArtifactAccepted>(`/api/artifacts/${encodeURIComponent(artifactId)}/upload-sessions`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body
  });
}

export async function publishArtifact(
  artifactId: string,
  input: string | {
    versionId?: string;
    expiration: { kind: "permanent" } | { kind: "duration"; durationSeconds: number } | { kind: "exact"; expiresAt: string };
    link: { mode: "reuse" } | { mode: "replace"; confirmRetire: true };
  },
  idempotencyKey: string
): Promise<{ artifact: Artifact } | Artifact["publication"]> {
  const body = typeof input === "string" ? { versionId: input } : input;
  const response = await request<{ artifact: Artifact; publication: NonNullable<Artifact["publication"]>; shareLink: NonNullable<Artifact["shareLink"]> }>(
    `/api/artifacts/${encodeURIComponent(artifactId)}/publications`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body)
    }
  );
  return typeof input === "string" ? response.publication : response;
}

export async function unpublishArtifact(artifactId: string, publicationId: string): Promise<void> {
  await requestWithoutBody(
    `/api/artifacts/${encodeURIComponent(artifactId)}/publications/${encodeURIComponent(publicationId)}`,
    { method: "DELETE" }
  );
}

export function createArtifact(input: {
  name: string;
  file: File;
  idempotencyKey: string;
  onProgress?: (percent: number) => void;
}): Promise<ArtifactAccepted> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const body = new FormData();
    body.set("name", input.name);
    body.set("file", input.file);

    request.open("POST", "/api/artifacts");
    request.withCredentials = true;
    request.setRequestHeader("Idempotency-Key", input.idempotencyKey);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        input.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () => reject(new ArtifactApiError("The upload was interrupted.", "network_error", 0));
    request.onload = () => {
      const body = parseXhrBody(request.responseText);
      if (request.status >= 200 && request.status < 300) {
        resolve(body as ArtifactAccepted);
        return;
      }
      const error = body as ErrorResponse;
      reject(
        new ArtifactApiError(
          error.error?.message ?? "The upload could not be completed.",
          error.error?.code ?? "upload_failed",
          request.status,
          error.error?.action,
          error.error?.details
        )
      );
    };
    request.send(body);
  });
}

function parseXhrBody(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}
