import {
  galleryContentConfigurationFromEnv,
} from "../application/gallery/configuration.js";
import {
  PostgresAdministratorReviewCredentialValidator,
  PostgresPublicPlayerCredentialValidator,
} from "../application/gallery/content-credentials.js";
import { readGalleryRuntimeEligibility } from "../application/gallery/eligibility.js";
import { buildGalleryContentApp } from "../content/app.js";
import {
  GalleryContentObjectStorage,
  PostgresGalleryContentLookup,
} from "../content/adapters.js";
import { createContentAccessLog } from "../content/logging.js";
import { createDatabaseConnection } from "../db/connection.js";
import {
  R2ObjectStorage,
  type R2BucketBinding,
} from "../storage/r2-object-storage.js";
import type {
  CloudflareExecutionContext,
  CloudflareFetchHandler,
} from "./runtime.js";
import {
  releaseVersionEvidence,
  type CloudflareVersionMetadata,
} from "./release-version-evidence.js";

export type CloudflareContentBindings = Readonly<{
  HYPERDRIVE: Readonly<{ connectionString: string }>;
  ARTIFACTS: R2BucketBinding;
  WEB_ORIGIN: string;
  API_ORIGIN: string;
  GALLERY_ENABLED: boolean;
  GALLERY_CONTENT_ORIGIN: string;
  GALLERY_CONTENT_REGISTRABLE_SITE: string;
  GALLERY_MANAGEMENT_COOKIE_DOMAIN: string;
  GALLERY_NETWORK_POLICY: "deny_external";
  GALLERY_GRANT_REVISION: string;
  GALLERY_APPEAL_POLICY_REVISION: string;
  GALLERY_CHALLENGE_VERIFIER_READY: boolean;
  GALLERY_ADMINISTRATOR_AUTHORITY_READY: boolean;
  GALLERY_REPORTING_READY: boolean;
  GALLERY_NOTIFICATION_READY: boolean;
  GALLERY_APPEAL_READY: boolean;
  GALLERY_GOVERNANCE_READY: boolean;
  GALLERY_ISOLATED_CONTENT_READY: boolean;
  SERVICE_VERSION: string;
  DEPLOYMENT_ENVIRONMENT: string;
  CF_VERSION_METADATA: CloudflareVersionMetadata;
}>;

export function createCloudflareContentWorker(): CloudflareFetchHandler<CloudflareContentBindings> {
  return {
    async fetch(request, bindings, _context: CloudflareExecutionContext) {
      const versionEvidence = releaseVersionEvidence(
        request,
        "shareslices-content.internal",
        bindings.CF_VERSION_METADATA,
      );
      if (versionEvidence) return versionEvidence;
      const connection = createDatabaseConnection({
        mode: "hyperdrive",
        cache: "disabled",
        connectionString: bindings.HYPERDRIVE.connectionString,
        maxConnections: 1,
        connectionTimeoutMs: 5_000,
        idleTimeoutMs: 1_000,
      });
      try {
        const configuration = galleryContentConfigurationFromEnv(bindings);
        const liveEligible = async () => (
          await readGalleryRuntimeEligibility(connection.pool, configuration)
        ).eligible;
        const app = buildGalleryContentApp({
          accessLog: createContentAccessLog({
            serviceVersion: bindings.SERVICE_VERSION,
            deploymentEnvironment: bindings.DEPLOYMENT_ENVIRONMENT,
            emit: (line) => console.log(line),
          }),
          publicPlayer: new PostgresPublicPlayerCredentialValidator(
            connection.pool,
            liveEligible,
          ),
          administratorReview: new PostgresAdministratorReviewCredentialValidator(
            connection.pool,
          ),
          lookup: new PostgresGalleryContentLookup(connection.pool),
          storage: new GalleryContentObjectStorage(
            new R2ObjectStorage(bindings.ARTIFACTS),
          ),
        });
        return await app.fetch(request, bindings, _context);
      } finally {
        await connection.close();
      }
    },
  };
}

export default createCloudflareContentWorker();
