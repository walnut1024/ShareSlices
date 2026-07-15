import type { Context } from "hono";
import type { ValidationDetails } from "../application/artifacts/repositories.js";

export type CliCompatibilityDetails = {
  currentVersion: string;
  minimumVersion: string;
  operatingSystem: string;
  supportedOperatingSystems: string[];
};

export type SizeLimitDetails = {
  limitBytes: number;
  actualBytes?: number;
};

export type RequestFieldDetails = {
  expected?: string;
  received?: string;
};

export type FieldError = {
  path: string;
  code: string;
  message: string;
};

export type ErrorDetails = {
  action?: string;
  details?: ValidationDetails | CliCompatibilityDetails | SizeLimitDetails | RequestFieldDetails;
};

export type ErrorCode =
  | "invalid_request"
  | "invalid_expiration"
  | "email_already_registered"
  | "invalid_login"
  | "verification_required"
  | "invalid_verification"
  | "email_unavailable"
  | "invalid_reset_grant"
  | "unauthenticated"
  | "forbidden"
  | "artifact_not_found"
  | "upload_session_not_found"
  | "version_not_found"
  | "asset_not_found"
  | "thumbnail_not_found"
  | "version_not_ready"
  | "operation_in_progress"
  | "idempotency_conflict"
  | "invalid_artifact_state"
  | "archive_too_large"
  | "cli_upgrade_required"
  | "authorization_pending"
  | "slow_down"
  | "expired_token"
  | "access_denied"
  | "invalid_grant"
  | "rate_limited"
  | "internal_error";

const messages: Record<ErrorCode, string> = {
  invalid_request: "Invalid request.",
  invalid_expiration: "Publication expiration is invalid.",
  email_already_registered: "An account already exists for this email.",
  invalid_login: "Email or password is incorrect.",
  verification_required: "Verify your email to continue.",
  invalid_verification: "The verification code is invalid or expired.",
  email_unavailable: "Email is temporarily unavailable. Try again later.",
  invalid_reset_grant: "The password reset is invalid or expired.",
  unauthenticated: "Sign in to continue.",
  forbidden: "Request origin is not allowed.",
  artifact_not_found: "Artifact not found.",
  upload_session_not_found: "Upload session not found.",
  version_not_found: "Version not found.",
  asset_not_found: "Asset not found.",
  thumbnail_not_found: "Thumbnail not found.",
  version_not_ready: "Version is not ready.",
  operation_in_progress: "Operation is still in progress.",
  idempotency_conflict: "Idempotency key was used with different input.",
  invalid_artifact_state: "Artifact state does not allow this operation.",
  archive_too_large: "ZIP exceeds the upload limit.",
  cli_upgrade_required: "Update ShareSlices CLI to continue.",
  authorization_pending: "Authorization is still pending.",
  slow_down: "Authorization polling is too frequent.",
  expired_token: "Authorization has expired.",
  access_denied: "Authorization was denied.",
  invalid_grant: "Authorization is no longer valid.",
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
  status: 400 | 401 | 403 | 404 | 409 | 413 | 426 | 429 | 500,
  code: ErrorCode,
  fields?: FieldError[],
  details?: ErrorDetails
) {
  const id = requestId(c);
  c.header("X-Request-Id", id);

  return c.json(
    {
      error: {
        code,
        message: messages[code],
        requestId: id,
        ...(fields && fields.length > 0 ? { fields } : {}),
        ...(details?.action ? { action: details.action } : {}),
        ...(details?.details ? { details: details.details } : {})
      }
    },
    status
  );
}
