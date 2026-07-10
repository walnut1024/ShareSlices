import type { Context } from "hono";

export type FieldError = {
  path: string;
  code: string;
  message: string;
};

export type ErrorCode =
  | "invalid_request"
  | "email_already_registered"
  | "invalid_login"
  | "unauthenticated"
  | "artifact_not_found"
  | "upload_session_not_found"
  | "version_not_found"
  | "asset_not_found"
  | "version_not_ready"
  | "operation_in_progress"
  | "idempotency_conflict"
  | "invalid_artifact_state"
  | "archive_too_large"
  | "rate_limited"
  | "internal_error";

const messages: Record<ErrorCode, string> = {
  invalid_request: "Invalid request.",
  email_already_registered: "An account already exists for this email.",
  invalid_login: "Email or password is incorrect.",
  unauthenticated: "Sign in to continue.",
  artifact_not_found: "Artifact not found.",
  upload_session_not_found: "Upload session not found.",
  version_not_found: "Version not found.",
  asset_not_found: "Asset not found.",
  version_not_ready: "Version is not ready.",
  operation_in_progress: "Operation is still in progress.",
  idempotency_conflict: "Idempotency key was used with different input.",
  invalid_artifact_state: "Artifact state does not allow this operation.",
  archive_too_large: "ZIP exceeds the upload limit.",
  rate_limited: "Too many attempts. Try again later.",
  internal_error: "Internal server error."
};

export function requestId(c: Context): string {
  const assigned = c.get("requestId");
  if (typeof assigned === "string") {
    return assigned;
  }

  const existing = c.req.header("x-request-id");
  const id = existing && existing.trim().length > 0 ? existing : `req_${crypto.randomUUID().replaceAll("-", "")}`;
  c.set("requestId", id);
  return id;
}

export function errorJson(
  c: Context,
  status: 400 | 401 | 404 | 409 | 413 | 429 | 500,
  code: ErrorCode,
  fields?: FieldError[]
) {
  const id = requestId(c);
  c.header("X-Request-Id", id);

  return c.json(
    {
      error: {
        code,
        message: messages[code],
        requestId: id,
        ...(fields && fields.length > 0 ? { fields } : {})
      }
    },
    status
  );
}
