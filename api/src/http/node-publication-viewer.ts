import { ArtifactManagementService } from "../application/artifacts/artifact-management.js";
import { PublicationViewerService } from "../application/artifacts/publication-viewer.js";
import { auth } from "../auth/auth.js";
import { createArtifactRepositories } from "../db/artifact-repositories.js";
import { createArtifactThumbnailRepository } from "../db/artifact-thumbnail-repository.js";
import { db } from "../db/client.js";
import { createConfiguredIdempotencyEvidenceCipher } from "../db/node-idempotency-evidence.js";
import { createPublicationContentRepository } from "../db/publication-content-repository.js";
import type { ApiHttpEnv } from "../env.js";
import { createConfiguredObjectStorage } from "../storage/index.js";
import type { PublicationViewerRouteDependencies } from "./publication-viewer-routes.js";

export function createNodePublicationViewerDependencies(
  env: Pick<ApiHttpEnv, "VIEWER_ORIGIN" | "WEB_ORIGIN">,
): PublicationViewerRouteDependencies {
  const storage = createConfiguredObjectStorage();
  const evidenceCipher = createConfiguredIdempotencyEvidenceCipher();
  return {
    authApi: auth.api,
    service: new PublicationViewerService(
      createPublicationContentRepository(db, evidenceCipher),
      env.VIEWER_ORIGIN,
    ),
    management: new ArtifactManagementService({
      repositories: createArtifactRepositories(db, evidenceCipher),
      viewerOrigin: env.VIEWER_ORIGIN,
      storage,
    }),
    storage,
    thumbnailRepository: createArtifactThumbnailRepository(db),
    managementOrigin: env.WEB_ORIGIN,
  };
}
