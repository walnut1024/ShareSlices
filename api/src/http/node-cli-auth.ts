import { auth } from "../auth/auth.js";
import type { ApiHttpEnv } from "../env.js";
import { createCliAuthDependencies } from "./cli-auth-composition.js";
import type { CliAuthDependencies } from "./cli-auth-routes.js";

export function createNodeCliAuthDependencies(
  env: Pick<ApiHttpEnv, "MINIMUM_CLI_VERSION">,
): CliAuthDependencies {
  return createCliAuthDependencies(auth.api, env.MINIMUM_CLI_VERSION);
}
