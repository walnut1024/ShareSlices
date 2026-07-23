import { ArtifactManagementService } from "../application/artifacts/artifact-management.js";
import { ArtifactIntakeService } from "../application/artifacts/artifact-intake.js";
import { ArtifactRecoveryService } from "../application/artifacts/artifact-recovery.js";
import { RawFingerprintCandidates } from "../application/artifacts/raw-fingerprint.js";
import { auth } from "../auth/auth.js";
import { createArtifactRepositories } from "../db/artifact-repositories.js";
import type { ApiHttpEnv } from "../env.js";
import { createConfiguredObjectStorage } from "../storage/index.js";
import type { ArtifactRouteDependencies } from "./artifact-routes.js";

type NodeArtifactEnvironment = Pick<
  ApiHttpEnv,
  | "CONTENT_FINGERPRINT_KEY_CURRENT_REVISION"
  | "CONTENT_FINGERPRINT_KEY_CURRENT"
  | "CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION"
  | "CONTENT_FINGERPRINT_KEY_PREVIOUS"
  | "VIEWER_ORIGIN"
  | "WORKER_JOB_MAX_ATTEMPTS"
  | "ARTIFACT_PROCESSING_REVISION"
  | "CONTENT_IDENTITY_REVISION"
>;

export function createNodeArtifactDependencies(
  env: NodeArtifactEnvironment,
): ArtifactRouteDependencies {
  const repositories = createArtifactRepositories();
  const storage = createConfiguredObjectStorage();
  const rawFingerprints = new RawFingerprintCandidates({
    current: {
      revision: env.CONTENT_FINGERPRINT_KEY_CURRENT_REVISION,
      secret: env.CONTENT_FINGERPRINT_KEY_CURRENT
    },
    ...(env.CONTENT_FINGERPRINT_KEY_PREVIOUS && env.CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION
      ? {
          previous: {
            revision: env.CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION,
            secret: env.CONTENT_FINGERPRINT_KEY_PREVIOUS
          }
        }
      : {})
  });
  const shared = {
    repositories,
    storage,
    viewerOrigin: env.VIEWER_ORIGIN,
    maxProcessingAttempts: env.WORKER_JOB_MAX_ATTEMPTS,
    rawFingerprints,
    processingRevision: env.ARTIFACT_PROCESSING_REVISION,
    contentIdentityRevision: env.CONTENT_IDENTITY_REVISION,
  };
  return {
    authApi: auth.api,
    repositories: {uploadPolicies: repositories.uploadPolicies},
    management: new ArtifactManagementService({
      repositories,
      viewerOrigin: env.VIEWER_ORIGIN,
      storage,
    }),
    intake: new ArtifactIntakeService(shared),
    recovery: new ArtifactRecoveryService(shared),
  };
}
