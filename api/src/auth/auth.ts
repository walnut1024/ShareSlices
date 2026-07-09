import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/client.js";
import { env } from "../env.js";
import * as schema from "../db/schema.js";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN, env.BETTER_AUTH_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false
  },
  advanced: {
    cookies: {
      session_token: {
        name: "shareslices_session"
      }
    }
  }
});
