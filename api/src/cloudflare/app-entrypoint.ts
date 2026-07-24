import { ArtifactIntakeService } from "../application/artifacts/artifact-intake.js";
import { ArtifactManagementService } from "../application/artifacts/artifact-management.js";
import { ArtifactRecoveryService } from "../application/artifacts/artifact-recovery.js";
import { PublicationViewerService } from "../application/artifacts/publication-viewer.js";
import { RawFingerprintCandidates } from "../application/artifacts/raw-fingerprint.js";
import { TurnstileChallengeVerifier, type ChallengeVerifier } from "../application/gallery/challenge-verifier.js";
import { galleryConfigurationFromEnv } from "../application/gallery/configuration.js";
import { GalleryContentCredentialService } from "../application/gallery/content-credentials.js";
import { GalleryCopyService } from "../application/gallery/copy.js";
import { GalleryCreatorProfileService } from "../application/gallery/creator-profile.js";
import { GalleryDownloadService } from "../application/gallery/download.js";
import { GalleryDownloadArchiveService } from "../application/gallery/download-archive.js";
import { PostgresGalleryRuntimeGate } from "../application/gallery/eligibility.js";
import { GalleryGovernanceService } from "../application/gallery/governance.js";
import { GalleryAvatarService } from "../application/gallery/avatar-media.js";
import { GalleryOwnerOperations } from "../application/gallery/owner-operations.js";
import { GalleryPermissionGrantService } from "../application/gallery/permission-grant.js";
import { PublicGalleryService } from "../application/gallery/public-gallery.js";
import { GalleryReportService } from "../application/gallery/reports.js";
import { createAuth } from "../auth/create-auth.js";
import { parseVersionedAuthSecrets } from "../auth/versioned-secrets.js";
import { createAccountQueries } from "../db/account-queries.js";
import { createArtifactRepositories } from "../db/artifact-repositories.js";
import { createArtifactThumbnailRepository } from "../db/artifact-thumbnail-repository.js";
import { createAuthenticationEmailRepository } from "../db/authentication-email-repository.js";
import { createDatabaseConnection } from "../db/connection.js";
import { IdempotencyEvidenceCipher } from "../db/idempotency-evidence.js";
import { createPublicationContentRepository } from "../db/publication-content-repository.js";
import type { ApiHttpEnv } from "../env.js";
import { accountRoutes } from "../http/account-routes.js";
import { artifactRoutes } from "../http/artifact-routes.js";
import { createCliAuthDependencies } from "../http/cli-auth-composition.js";
import { cliAuthRoutes } from "../http/cli-auth-routes.js";
import { cloudflareTrustedIngressResolver } from "../http/cloudflare-trusted-ingress.js";
import { galleryRoutes } from "../http/gallery-routes.js";
import { publicationViewerRoutes } from "../http/publication-viewer-routes.js";
import { systemRoutes } from "../http/system-routes.js";
import { buildTrustedHttpApp } from "../http/trusted-app.js";
import { R2ObjectStorage, type R2BucketBinding } from "../storage/r2-object-storage.js";
import { createCloudflareLogger } from "./logger.js";
import type { CloudflareExecutionContext, CloudflareFetchHandler } from "./runtime.js";
import {
  CloudflareViewerByteReader,
  type ViewerByteCache,
} from "./viewer-byte-cache.js";

type AppEnvironment = Pick<
  ApiHttpEnv,
  | "WEB_ORIGIN"
  | "API_ORIGIN"
  | "BETTER_AUTH_URL"
  | "BETTER_AUTH_SECRET"
  | "AUTH_EMAIL_ENCRYPTION_KEY"
  | "AUTH_EMAIL_RESEND_SECONDS"
  | "AUTH_EMAIL_GLOBAL_HOUR"
  | "AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS"
  | "AUTH_EMAIL_PER_EMAIL_HOUR"
  | "AUTH_EMAIL_PER_EMAIL_DAY"
  | "AUTH_EMAIL_PER_IP_HOUR"
  | "AUTH_EMAIL_PER_IP_DAY"
  | "REQUIRE_EMAIL_VERIFICATION"
  | "MINIMUM_CLI_VERSION"
  | "CONTENT_FINGERPRINT_KEY_CURRENT_REVISION"
  | "CONTENT_FINGERPRINT_KEY_CURRENT"
  | "CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION"
  | "CONTENT_FINGERPRINT_KEY_PREVIOUS"
  | "IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION"
  | "IDEMPOTENCY_ENCRYPTION_KEY_CURRENT"
  | "IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION"
  | "IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS"
  | "VIEWER_ORIGIN"
  | "WORKER_JOB_MAX_ATTEMPTS"
  | "ARTIFACT_PROCESSING_REVISION"
  | "CONTENT_IDENTITY_REVISION"
  | "ARTIFACT_RENDERER_REVISION"
  | "GALLERY_TURNSTILE_SECRET"
  | "GALLERY_ENABLED"
  | "GALLERY_CONTENT_ORIGIN"
  | "GALLERY_CONTENT_REGISTRABLE_SITE"
  | "GALLERY_MANAGEMENT_COOKIE_DOMAIN"
  | "GALLERY_NETWORK_POLICY"
  | "GALLERY_GRANT_REVISION"
  | "GALLERY_APPEAL_POLICY_REVISION"
  | "GALLERY_CHALLENGE_VERIFIER_READY"
  | "GALLERY_ADMINISTRATOR_AUTHORITY_READY"
  | "GALLERY_REPORTING_READY"
  | "GALLERY_NOTIFICATION_READY"
  | "GALLERY_APPEAL_READY"
  | "GALLERY_GOVERNANCE_READY"
  | "GALLERY_ISOLATED_CONTENT_READY"
>;

export type CloudflareAppBindings = Readonly<
  AppEnvironment & {
    HYPERDRIVE: Readonly<{ connectionString: string }>;
    ARTIFACTS: R2BucketBinding;
    ASSETS: Readonly<{ fetch(request: Request): Promise<Response> }>;
    GALLERY_TURNSTILE_SITE_KEY?: string;
    SERVICE_VERSION: string;
    DEPLOYMENT_ENVIRONMENT: string;
    BETTER_AUTH_SECRETS: string;
    EDGE_CDN_MODE: "web-assets-only" | "web-and-public-viewer-bytes";
    VIEWER_BYTE_CACHE_MAX_ASSET_BYTES: number;
  }
>;

export const cloudflareAppWorkerFirstPathPrefixes = Object.freeze([
  "/a",
  "/api",
  "/gallery",
  "/gallery-content",
  "/health",
  "/internal",
  "/ready",
  "/runtime-config.json",
]);

function configuredOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function staticFallbackEligible(request: Request, bindings: CloudflareAppBindings): boolean {
  if (!new Set(["GET", "HEAD"]).has(request.method)) return false;
  const url = new URL(request.url);
  if (url.origin !== configuredOrigin(bindings.WEB_ORIGIN)) return false;
  return !cloudflareAppWorkerFirstPathPrefixes.some(
    (prefix) =>
      url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
  );
}

function configuredHost(request: Request, bindings: CloudflareAppBindings): boolean {
  const origin = new URL(request.url).origin;
  return new Set([
    configuredOrigin(bindings.WEB_ORIGIN),
    configuredOrigin(bindings.API_ORIGIN),
  ]).has(origin);
}

function viewerByteCache(): ViewerByteCache {
  const cache = (
    globalThis as typeof globalThis & {
      caches?: Readonly<{ default?: ViewerByteCache }>;
    }
  ).caches?.default;
  if (!cache) throw new Error("cloudflare_default_cache_unavailable");
  return cache;
}

function runtimeConfiguration(
  request: Request,
  bindings: CloudflareAppBindings,
): Response | null {
  const url = new URL(request.url);
  if (
    url.origin !== configuredOrigin(bindings.WEB_ORIGIN) ||
    url.pathname !== "/runtime-config.json"
  ) {
    return null;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Cache-Control": "no-store",
      },
    });
  }
  const body = JSON.stringify({
    apiOrigin: configuredOrigin(bindings.API_ORIGIN),
    viewerOrigin: configuredOrigin(bindings.VIEWER_ORIGIN),
    galleryContentOrigin: configuredOrigin(bindings.GALLERY_CONTENT_ORIGIN),
    galleryTurnstileSiteKey: bindings.GALLERY_TURNSTILE_SITE_KEY ?? null,
  });
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
}

function evidenceCipher(bindings: CloudflareAppBindings) {
  return new IdempotencyEvidenceCipher({
    current: {
      revision: bindings.IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION,
      secret: bindings.IDEMPOTENCY_ENCRYPTION_KEY_CURRENT,
    },
    ...(bindings.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS &&
    bindings.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION
      ? {
          previous: {
            revision: bindings.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION,
            secret: bindings.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS,
          },
        }
      : {}),
  });
}

async function bindConnectionLifetime(
  response: Response,
  close: () => Promise<void>,
): Promise<Response> {
  if (!response.body) {
    await close();
    return response;
  }
  const reader = response.body.getReader();
  let closed = false;
  const closeOnce = async () => {
    if (closed) return;
    closed = true;
    await close();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          await closeOnce();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        controller.error(error);
        await closeOnce();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await closeOnce();
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function createCloudflareAppWorker(): CloudflareFetchHandler<CloudflareAppBindings> {
  return {
    async fetch(request, bindings, context: CloudflareExecutionContext) {
      if (!configuredHost(request, bindings)) {
        return new Response("Not Found", {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=UTF-8",
          },
        });
      }
      const bootstrap = runtimeConfiguration(request, bindings);
      if (bootstrap) return bootstrap;
      if (new URL(request.url).pathname.startsWith("/internal/")) {
        return new Response("Not Found", {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=UTF-8",
          },
        });
      }
      const connection = createDatabaseConnection({
        mode: "hyperdrive",
        cache: "disabled",
        connectionString: bindings.HYPERDRIVE.connectionString,
        maxConnections: 1,
        connectionTimeoutMs: 5_000,
        idleTimeoutMs: 1_000,
      });
      try {
        const logger = createCloudflareLogger({
          serviceVersion: bindings.SERVICE_VERSION,
          deploymentEnvironment: bindings.DEPLOYMENT_ENVIRONMENT,
        });
        const accountQueries = createAccountQueries(connection.pool);
        const emailRepository = createAuthenticationEmailRepository({
          connection,
          pool: connection.pool,
          logger,
          configuration: bindings,
        });
        const authComposition = createAuth({
          database: connection.database,
          baseUrl: bindings.BETTER_AUTH_URL,
          secret: bindings.BETTER_AUTH_SECRET,
          secrets: parseVersionedAuthSecrets(bindings.BETTER_AUTH_SECRETS),
          webOrigin: bindings.WEB_ORIGIN,
          emailEncryptionKey: bindings.AUTH_EMAIL_ENCRYPTION_KEY,
          findPasswordHashByEmail: accountQueries.findPasswordHashByEmail,
          createVerificationAttempt: emailRepository.createVerificationAttempt,
          findLatestVerificationAttempt:
            emailRepository.findLatestVerificationAttempt,
          acceptAuthenticationEmailDelivery:
            emailRepository.acceptAuthenticationEmailDelivery,
        });
        const cipher = evidenceCipher(bindings);
        const repositories = createArtifactRepositories(
          connection.database,
          cipher,
        );
        const storage = new R2ObjectStorage(bindings.ARTIFACTS);
        const rawFingerprints = new RawFingerprintCandidates({
          current: {
            revision: bindings.CONTENT_FINGERPRINT_KEY_CURRENT_REVISION,
            secret: bindings.CONTENT_FINGERPRINT_KEY_CURRENT,
          },
          ...(bindings.CONTENT_FINGERPRINT_KEY_PREVIOUS &&
          bindings.CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION
            ? {
                previous: {
                  revision: bindings.CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION,
                  secret: bindings.CONTENT_FINGERPRINT_KEY_PREVIOUS,
                },
              }
            : {}),
        });
        const artifactShared = {
          repositories,
          storage,
          viewerOrigin: bindings.VIEWER_ORIGIN,
          maxProcessingAttempts: bindings.WORKER_JOB_MAX_ATTEMPTS,
          rawFingerprints,
          processingRevision: bindings.ARTIFACT_PROCESSING_REVISION,
          contentIdentityRevision: bindings.CONTENT_IDENTITY_REVISION,
        };
        const management = new ArtifactManagementService({
          repositories,
          viewerOrigin: bindings.VIEWER_ORIGIN,
          storage,
        });
        const publicationRepository = createPublicationContentRepository(
          connection.database,
          cipher,
        );
        const galleryConfiguration = galleryConfigurationFromEnv(bindings);
        const downloads = new GalleryDownloadService(connection.pool, "cloudflare-app");
        const unavailableVerifier: ChallengeVerifier = {
          verify: async () => ({ success: false, reasonCode: "unavailable" }),
        };
        const galleryDependencies = {
          authApi: authComposition.auth.api,
          owner: new GalleryOwnerOperations(
            connection.pool,
            {
              policyRevision: "gallery-safety/v1",
              maxFileCount: 1000,
              maxTotalBytes: 209715200,
              maxSingleFileBytes: 52428800,
              findingDecisions: {
                external_resource_dependency: "reject" as const,
                external_programmatic_request: "reject" as const,
                external_form_action: "reject" as const,
                executable_dynamic_construction: "review" as const,
              },
              evidenceDigestAlgorithm: "sha256" as const,
              replayRequiresExactPolicyRevision: true,
            },
            bindings.ARTIFACT_RENDERER_REVISION,
          ),
          profiles: new GalleryCreatorProfileService(connection.pool),
          grants: new GalleryPermissionGrantService(connection.pool),
          publicGallery: new PublicGalleryService(connection.pool),
          downloadArchive: new GalleryDownloadArchiveService(
            downloads,
            storage,
            logger,
          ),
          avatars: new GalleryAvatarService(connection.pool, storage),
          copy: new GalleryCopyService(
            connection.pool,
            bindings.WORKER_JOB_MAX_ATTEMPTS,
          ),
          reports: new GalleryReportService(
            connection.pool,
            bindings.GALLERY_TURNSTILE_SECRET
              ? new TurnstileChallengeVerifier(
                  bindings.GALLERY_TURNSTILE_SECRET,
                )
              : unavailableVerifier,
          ),
          governance: new GalleryGovernanceService(connection.pool),
          credentials: new GalleryContentCredentialService(connection.pool),
          gate: new PostgresGalleryRuntimeGate(
            connection.pool,
            galleryConfiguration,
          ),
          contentOrigin: galleryConfiguration.contentOrigin,
        };
        const app = buildTrustedHttpApp({
          configuration: {
            webOrigin: bindings.WEB_ORIGIN,
            minimumCliVersion: bindings.MINIMUM_CLI_VERSION,
          },
          logger,
          trustedIngress: cloudflareTrustedIngressResolver,
          routes: {
            system: systemRoutes({
              checkDatabase: async () => {
                await connection.pool.query("select 1");
              },
            }),
            account: accountRoutes({
              authApi: authComposition.auth.api,
              ...accountQueries,
              ...emailRepository,
              verifyPasswordCredential:
                authComposition.verifyPasswordCredential,
              requireEmailVerification:
                bindings.REQUIRE_EMAIL_VERIFICATION,
              webOrigin: bindings.WEB_ORIGIN,
              resendSeconds: bindings.AUTH_EMAIL_RESEND_SECONDS,
              emailEncryptionKey: bindings.AUTH_EMAIL_ENCRYPTION_KEY,
            }),
            cliAuth: cliAuthRoutes(
              createCliAuthDependencies(
                authComposition.auth.api,
                bindings.MINIMUM_CLI_VERSION,
              ),
            ),
            artifact: artifactRoutes({
              authApi: authComposition.auth.api,
              repositories: { uploadPolicies: repositories.uploadPolicies },
              management,
              intake: new ArtifactIntakeService(artifactShared),
              recovery: new ArtifactRecoveryService(artifactShared),
            }),
            publicationViewer: publicationViewerRoutes({
              authApi: authComposition.auth.api,
              service: new PublicationViewerService(
                publicationRepository,
                bindings.VIEWER_ORIGIN,
              ),
              management,
              storage,
              ...(bindings.EDGE_CDN_MODE === "web-and-public-viewer-bytes"
                ? {
                    viewerBytes: new CloudflareViewerByteReader({
                      storage,
                      cache: viewerByteCache(),
                      maxAssetBytes:
                        bindings.VIEWER_BYTE_CACHE_MAX_ASSET_BYTES,
                      rendererRevision: bindings.ARTIFACT_RENDERER_REVISION,
                      defer: (promise) => context.waitUntil(promise),
                    }),
                  }
                : {}),
              thumbnailRepository: createArtifactThumbnailRepository(
                connection.database,
              ),
              managementOrigin: bindings.WEB_ORIGIN,
            }),
            gallery: galleryRoutes(galleryDependencies),
          },
        });
        const response = await app.fetch(request, bindings, context);
        if (
          response.status === 404 &&
          staticFallbackEligible(request, bindings)
        ) {
          await response.body?.cancel();
          await connection.close();
          return await bindings.ASSETS.fetch(request);
        }
        return await bindConnectionLifetime(response, connection.close);
      } catch (error) {
        await connection.close();
        throw error;
      }
    },
  };
}

export default createCloudflareAppWorker();
