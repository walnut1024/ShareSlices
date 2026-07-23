import { Hono } from "hono";
import { readApiHttpEnv } from "../env.js";
import { apiLogger } from "../logging/index.js";
import { checkDatabase } from "../db/system-queries.js";
import {
  accountRoutes,
  type AccountRouteDependencies,
} from "./account-routes.js";
import { createNodeAccountDependencies } from "./node-account.js";
import { cliAuthRoutes, type CliAuthDependencies } from "./cli-auth-routes.js";
import { createNodeCliAuthDependencies } from "./node-cli-auth.js";
import {
  artifactRoutes,
  type ArtifactRouteDependencies,
} from "./artifact-routes.js";
import {
  publicationViewerRoutes,
  type PublicationViewerRouteDependencies,
} from "./publication-viewer-routes.js";
import { systemRoutes, type SystemRouteDependencies } from "./system-routes.js";
import {
  galleryRoutes,
  type GalleryRouteDependencies,
} from "./gallery-routes.js";
import { buildTrustedHttpApp } from "./trusted-app.js";
import type { TrustedIngressResolver } from "./trusted-ingress.js";

const env = readApiHttpEnv();

export type AppDependencies = {
  account?: Partial<AccountRouteDependencies>;
  cliAuth?: Partial<CliAuthDependencies>;
  artifact?: Partial<ArtifactRouteDependencies>;
  publicationViewer?: Partial<PublicationViewerRouteDependencies>;
  system?: Partial<SystemRouteDependencies>;
  gallery?: Partial<GalleryRouteDependencies>;
};

export function buildApp(
  dependencies: AppDependencies = {},
  adapters: Readonly<{ trustedIngress?: TrustedIngressResolver }> = {},
): Hono {
  return buildTrustedHttpApp({
    configuration: {
      webOrigin: env.WEB_ORIGIN,
      minimumCliVersion: dependencies.cliAuth?.minimumCliVersion ?? env.MINIMUM_CLI_VERSION,
    },
    logger: apiLogger,
    trustedIngress: adapters.trustedIngress ?? (() => ({ clientIp: "unknown", source: "unknown" })),
    routes: {
      system: systemRoutes({checkDatabase, ...dependencies.system}),
      account: accountRoutes({...createNodeAccountDependencies(env), ...dependencies.account}),
      cliAuth: cliAuthRoutes({...createNodeCliAuthDependencies(env), ...dependencies.cliAuth}),
      artifact: artifactRoutes(dependencies.artifact),
      publicationViewer: publicationViewerRoutes(dependencies.publicationViewer),
      gallery: galleryRoutes(dependencies.gallery),
    },
  });
}
