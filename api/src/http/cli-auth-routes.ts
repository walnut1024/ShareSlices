import { APIError } from "better-auth/api";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { checkCliCompatibility } from "./cli-compatibility.js";
import { errorJson, requestId } from "./http-error.js";

export const CLI_CLIENT_ID = "shareslices-cli";

export type AuthorizationStatus = "pending" | "approved" | "denied";

export type CliAuthDependencies = {
  minimumCliVersion: string;
  createAuthorization(): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
  }>;
  readAuthorization(userCode: string, headers: Headers): Promise<{ userCode: string; status: AuthorizationStatus } | null>;
  approveAuthorization(userCode: string, headers: Headers): Promise<void>;
  denyAuthorization(userCode: string, headers: Headers): Promise<void>;
  exchangeAuthorization(deviceCode: string): Promise<{ accessToken: string; tokenType: "Bearer"; expiresIn: number }>;
  currentSession(headers: Headers): Promise<{ token: string; userId: string } | null>;
  revokeSession(token: string, headers: Headers): Promise<boolean>;
};

function formatUserCode(value: string): string {
  const clean = value.replaceAll("-", "");
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : value;
}

function pluginErrorCode(error: unknown): string | null {
  if (error instanceof APIError) {
    const body = error.body as { error?: unknown };
    return typeof body.error === "string" ? body.error : null;
  }
  return error instanceof Error ? error.message : null;
}

function pluginErrorResponse(c: Context, error: unknown) {
  const code = pluginErrorCode(error);
  if (code === "unauthorized") return errorJson(c, 401, "unauthenticated");
  if (code === "access_denied") return errorJson(c, 403, "access_denied");
  if (code === "expired_token") return errorJson(c, 400, "expired_token");
  if (code === "invalid_request") return errorJson(c, 400, "invalid_request");
  return null;
}

export function cliAuthRoutes(dependencies: CliAuthDependencies): Hono {
  const app = new Hono();

  function compatibility(c: Parameters<typeof errorJson>[0]) {
    return checkCliCompatibility(c, dependencies.minimumCliVersion);
  }

  app.post("/api/cli-authorizations", async (c) => {
    const incompatible = compatibility(c);
    if (incompatible) return incompatible;
    const body = z.object({ clientId: z.literal(CLI_CLIENT_ID) }).strict().safeParse(await c.req.json().catch(() => null));
    if (!body.success) return errorJson(c, 400, "invalid_request");
    const value = await dependencies.createAuthorization();
    c.header("Cache-Control", "no-store");
    c.header("X-Request-Id", requestId(c));
    return c.json(
      {
        authorization: {
          ...value,
          userCode: formatUserCode(value.userCode)
        }
      },
      201
    );
  });

  app.get("/api/cli-authorizations/:userCode", async (c) => {
    let value;
    try {
      value = await dependencies.readAuthorization(c.req.param("userCode"), c.req.raw.headers);
    } catch (error) {
      const response = pluginErrorResponse(c, error);
      if (response) return response;
      throw error;
    }
    if (!value) return errorJson(c, 401, "unauthenticated");
    c.header("Cache-Control", "no-store");
    return c.json({ authorization: { userCode: formatUserCode(value.userCode), status: value.status } });
  });

  app.post("/api/cli-authorizations/:authorizationAction", async (c) => {
    const action = c.req.param("authorizationAction");
    const separator = action.lastIndexOf(":");
    if (separator < 1) return errorJson(c, 404, "invalid_request");
    const userCode = action.slice(0, separator);
    const verb = action.slice(separator + 1);
    try {
      if (verb === "approve") await dependencies.approveAuthorization(userCode, c.req.raw.headers);
      else if (verb === "deny") await dependencies.denyAuthorization(userCode, c.req.raw.headers);
      else return errorJson(c, 404, "invalid_request");
    } catch (error) {
      const response = pluginErrorResponse(c, error);
      if (response) return response;
      throw error;
    }
    c.header("Cache-Control", "no-store");
    c.header("X-Request-Id", requestId(c));
    return c.body(null, 204);
  });

  app.post("/api/cli-sessions", async (c) => {
    const incompatible = compatibility(c);
    if (incompatible) return incompatible;
    const body = z
      .object({ clientId: z.literal(CLI_CLIENT_ID), deviceCode: z.string().min(1) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return errorJson(c, 400, "invalid_request");
    try {
      const session = await dependencies.exchangeAuthorization(body.data.deviceCode);
      c.header("Cache-Control", "no-store");
      return c.json({ session }, 201);
    } catch (error) {
      const code = pluginErrorCode(error);
      if (["authorization_pending", "slow_down", "expired_token", "access_denied", "invalid_grant"].includes(code ?? "")) {
        return errorJson(c, 400, code as "authorization_pending");
      }
      throw error;
    }
  });

  app.delete("/api/cli-sessions/current", async (c) => {
    const incompatible = compatibility(c);
    if (incompatible) return incompatible;
    const session = await dependencies.currentSession(c.req.raw.headers);
    if (!session) return errorJson(c, 401, "unauthenticated");
    if (!(await dependencies.revokeSession(session.token, c.req.raw.headers))) {
      throw new Error("CLI Session revocation failed.");
    }
    c.header("Cache-Control", "no-store");
    c.header("X-Request-Id", requestId(c));
    return c.body(null, 204);
  });

  return app;
}
