import { auth } from "../auth/auth.js";
import type { ApiHttpEnv } from "../env.js";
import {
  CLI_CLIENT_ID,
  type AuthorizationStatus,
  type CliAuthDependencies,
} from "./cli-auth-routes.js";

export function createNodeCliAuthDependencies(
  env: Pick<ApiHttpEnv, "MINIMUM_CLI_VERSION">,
): CliAuthDependencies {
  return {
    minimumCliVersion: env.MINIMUM_CLI_VERSION,
    async createAuthorization() {
      const value = await auth.api.deviceCode({ body: { client_id: CLI_CLIENT_ID } });
      return {
        deviceCode: value.device_code,
        userCode: value.user_code,
        verificationUri: value.verification_uri,
        verificationUriComplete: value.verification_uri_complete,
        expiresIn: value.expires_in,
        interval: value.interval
      };
    },
    async readAuthorization(userCode, headers) {
      try {
        const session = await auth.api.getSession({ headers, query: { disableRefresh: true } });
        if (!session) return null;
        const value = await auth.api.deviceVerify({ query: { user_code: userCode }, headers });
        return { userCode: value.user_code, status: value.status as AuthorizationStatus };
      } catch (error) {
        const body = error && typeof error === "object" && "body" in error
          ? error.body as {error?: unknown}
          : null;
        if (body?.error === "unauthorized") return null;
        throw error;
      }
    },
    async approveAuthorization(userCode, headers) {
      await auth.api.deviceApprove({ body: { userCode }, headers });
    },
    async denyAuthorization(userCode, headers) {
      await auth.api.deviceDeny({ body: { userCode }, headers });
    },
    async exchangeAuthorization(deviceCode) {
      const value = await auth.api.deviceToken({
        body: {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: CLI_CLIENT_ID
        }
      });
      return { accessToken: value.access_token, tokenType: "Bearer", expiresIn: value.expires_in };
    },
    async currentSession(headers) {
      const value = await auth.api.getSession({ headers, query: { disableRefresh: true } });
      return value ? { token: value.session.token, userId: value.user.id } : null;
    },
    async revokeSession(token, headers) {
      const value = await auth.api.revokeSession({ body: { token }, headers, asResponse: false });
      return value.status;
    }
  };
}
