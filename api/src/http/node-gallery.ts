import { galleryConfigurationFromEnv } from "../application/gallery/configuration.js";
import { TurnstileChallengeVerifier, type ChallengeVerifier } from "../application/gallery/challenge-verifier.js";
import { GalleryContentCredentialService } from "../application/gallery/content-credentials.js";
import { GalleryCreatorProfileService } from "../application/gallery/creator-profile.js";
import { GalleryCopyService } from "../application/gallery/copy.js";
import { GalleryDownloadService } from "../application/gallery/download.js";
import { GalleryDownloadArchiveService } from "../application/gallery/download-archive.js";
import { PostgresGalleryRuntimeGate } from "../application/gallery/eligibility.js";
import { GalleryGovernanceService } from "../application/gallery/governance.js";
import { GalleryAvatarService } from "../application/gallery/avatar-media.js";
import { GalleryOwnerOperations } from "../application/gallery/owner-operations.js";
import { GalleryPermissionGrantService } from "../application/gallery/permission-grant.js";
import { PublicGalleryService } from "../application/gallery/public-gallery.js";
import { GalleryReportService } from "../application/gallery/reports.js";
import { auth } from "../auth/auth.js";
import { pool } from "../db/client.js";
import type { ApiHttpEnv } from "../env.js";
import { createConfiguredObjectStorage } from "../storage/index.js";
import { apiLogger } from "../logging/index.js";
import type { GalleryRouteDependencies } from "./gallery-routes.js";

export function createNodeGalleryDependencies(
  env: ApiHttpEnv,
  workerIdentity = process.env.HOSTNAME ?? "api",
): GalleryRouteDependencies {
  const configuration = galleryConfigurationFromEnv(env);
  const unavailableVerifier: ChallengeVerifier = {
    verify: async () => ({ success: false, reasonCode: "unavailable" }),
  };
  const storage = createConfiguredObjectStorage();
  const downloads = new GalleryDownloadService(pool, workerIdentity);
  return {
    authApi: auth.api,
    owner: new GalleryOwnerOperations(
      pool,
      {
        policyRevision: "gallery-safety/v1",
        maxFileCount: 1000,
        maxTotalBytes: 209715200,
        maxSingleFileBytes: 52428800,
        findingDecisions: {
          external_resource_dependency: "reject",
          external_programmatic_request: "reject",
          external_form_action: "reject",
          executable_dynamic_construction: "review",
        },
        evidenceDigestAlgorithm: "sha256",
        replayRequiresExactPolicyRevision: true,
      },
      env.ARTIFACT_RENDERER_REVISION,
    ),
    profiles: new GalleryCreatorProfileService(pool),
    grants: new GalleryPermissionGrantService(pool),
    publicGallery: new PublicGalleryService(pool),
    downloadArchive: new GalleryDownloadArchiveService(
      downloads,
      storage,
      apiLogger,
    ),
    avatars: new GalleryAvatarService(pool, storage),
    copy: new GalleryCopyService(pool, env.WORKER_JOB_MAX_ATTEMPTS),
    reports: new GalleryReportService(
      pool,
      env.GALLERY_TURNSTILE_SECRET
        ? new TurnstileChallengeVerifier(env.GALLERY_TURNSTILE_SECRET)
        : unavailableVerifier,
    ),
    governance: new GalleryGovernanceService(pool),
    credentials: new GalleryContentCredentialService(pool),
    gate: new PostgresGalleryRuntimeGate(pool, configuration),
    contentOrigin: configuration.contentOrigin,
  };
}
