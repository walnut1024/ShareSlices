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
  | "rate_limited"
  | "internal_error";

const messages: Record<ErrorCode, string> = {
  invalid_request: "Invalid request.",
  email_already_registered: "An account already exists for this email.",
  invalid_login: "Email or password is incorrect.",
  unauthenticated: "Sign in to continue.",
  rate_limited: "Too many attempts. Try again later.",
  internal_error: "Internal server error."
};

export function requestId(c: Context): string {
  const existing = c.req.header("x-request-id");
  if (existing && existing.trim().length > 0) {
    return existing;
  }
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function errorJson(c: Context, status: 400 | 401 | 409 | 429 | 500, code: ErrorCode, fields?: FieldError[]) {
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
