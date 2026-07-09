import { APIError } from "better-auth";
import { Hono } from "hono";
import { ZodError } from "zod";
import { auth } from "../auth/auth.js";
import { loginInputSchema, registrationInputSchema } from "../auth/email.js";
import { userExistsByEmail, userExistsById } from "../db/account-queries.js";
import { errorJson, type FieldError, requestId } from "./http-error.js";

type AuthUser = {
  id: string;
  name: string;
  email: string;
};

export type AccountRouteDependencies = {
  authApi: Pick<typeof auth.api, "signUpEmail" | "signInEmail" | "getSession">;
  userExistsByEmail: typeof userExistsByEmail;
  userExistsById: typeof userExistsById;
};

function toUserResponse(user: AuthUser) {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
  };
}

function zodFields(error: ZodError): FieldError[] {
  return error.issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        path: [...issue.path, key].join("."),
        code: issue.code,
        message: fieldMessage(issue.code)
      }));
    }

    const code = /^invalid_[a-z0-9_]+$/.test(issue.message) ? issue.message : issue.code;
    return [{ path: issue.path.join("."), code, message: fieldMessage(code) }];
  });
}

function fieldMessage(code: string): string {
  if (code === "invalid_name") {
    return "Enter a name.";
  }
  if (code === "invalid_email") {
    return "Enter a valid email.";
  }
  if (code === "invalid_password") {
    return "Enter a valid password.";
  }
  return "Invalid field.";
}

function copyAuthSetCookie(from: Headers, to: Headers): void {
  const setCookie = from.get("set-cookie");
  if (setCookie) {
    to.append("Set-Cookie", setCookie);
  }
}

export function accountRoutes(overrides: Partial<AccountRouteDependencies> = {}): Hono {
  const dependencies: AccountRouteDependencies = {
    authApi: auth.api,
    userExistsByEmail,
    userExistsById,
    ...overrides
  };
  const app = new Hono();

  app.post("/api/users", async (c) => {
    const parsed = registrationInputSchema.safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) {
      return errorJson(c, 400, "invalid_request", zodFields(parsed.error));
    }

    if (await dependencies.userExistsByEmail(parsed.data.email)) {
      return errorJson(c, 409, "email_already_registered");
    }

    let response: { user: AuthUser };
    try {
      const result = await dependencies.authApi.signUpEmail({
        returnHeaders: true,
        body: {
          name: parsed.data.name,
          email: parsed.data.email,
          password: parsed.data.password
        }
      });
      response = result.response as { user: AuthUser };
    } catch (error) {
      if (
        error instanceof APIError &&
        error.statusCode === 422 &&
        (await dependencies.userExistsByEmail(parsed.data.email))
      ) {
        return errorJson(c, 409, "email_already_registered");
      }
      throw error;
    }

    const user = response.user as AuthUser;
    if (!(await dependencies.userExistsById(user.id))) {
      return errorJson(c, 409, "email_already_registered");
    }

    const id = requestId(c);
    c.header("X-Request-Id", id);
    return c.json(toUserResponse(user), 201);
  });

  app.post("/api/sessions", async (c) => {
    const parsed = loginInputSchema.safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) {
      return errorJson(c, 400, "invalid_request", zodFields(parsed.error));
    }

    try {
      const { headers, response } = await dependencies.authApi.signInEmail({
        returnHeaders: true,
        body: {
          email: parsed.data.email,
          password: parsed.data.password
        }
      });

      copyAuthSetCookie(headers, c.res.headers);

      const id = requestId(c);
      c.header("X-Request-Id", id);
      return c.json(
        {
          signedIn: true,
          user: toUserResponse(response.user as AuthUser).user
        },
        201
      );
    } catch (error) {
      if (error instanceof APIError && error.statusCode === 401) {
        return errorJson(c, 401, "invalid_login");
      }
      throw error;
    }
  });

  app.get("/api/users/me", async (c) => {
    const session = await dependencies.authApi.getSession({
      headers: c.req.raw.headers,
      query: { disableRefresh: true }
    });

    if (!session) {
      return errorJson(c, 401, "unauthenticated");
    }

    const id = requestId(c);
    c.header("X-Request-Id", id);
    return c.json(toUserResponse(session.user as AuthUser));
  });

  return app;
}
