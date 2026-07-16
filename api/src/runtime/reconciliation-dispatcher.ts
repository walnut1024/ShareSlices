import { ReconciliationModule } from "../application/reconciliation/reconciliation.js";
import { createArtifactRepositories } from "../db/artifact-repositories.js";
import { createReconciliationRepository } from "../db/reconciliation-repository.js";
import { apiLogger, exceptionAttributes } from "../logging/index.js";
import { createConfiguredObjectStorage } from "../storage/index.js";
import { GalleryReconciliation } from "../application/gallery/reconciliation.js";
import { GalleryRollbackCoordinator } from "../application/gallery/rollback-coordinator.js";
import { pool } from "../db/client.js";
import { env } from "../env.js";
import { evaluateGalleryEligibility } from "../application/gallery/eligibility.js";
import { galleryConfigurationFromEnv } from "../application/gallery/configuration.js";
import { observeGalleryCapabilityReadiness } from "../application/gallery/runtime-readiness.js";

const intervalMilliseconds = 30_000;
const batchSize = 100;

export function startReconciliationDispatcher(): () => void {
  const artifactRepositories = createArtifactRepositories();
  const module = new ReconciliationModule({
    repository: createReconciliationRepository(),
    storage: createConfiguredObjectStorage(),
  });
  const galleryReconciliation = new GalleryReconciliation(
    pool,
    createConfiguredObjectStorage(),
  );
  const galleryRollback = new GalleryRollbackCoordinator(pool, createConfiguredObjectStorage());
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await artifactRepositories.idempotency.reencryptPrevious(batchSize);
      await module.run({
        workType: "artifact_deletions",
        olderThan: new Date(),
        limit: batchSize,
      });
      const galleryConfiguration = galleryConfigurationFromEnv(env);
      const liveReadiness = await observeGalleryCapabilityReadiness(
        pool,
        galleryConfiguration,
      );
      const eligibility = evaluateGalleryEligibility(
        galleryConfiguration,
        liveReadiness,
      );
      await pool.query(`update gallery_runtime_status set eligible=$1,reasons=$2,observed_at=now() where singleton`,
        [eligibility.eligible, eligibility.reasons]);
      if (env.GALLERY_ENABLED) await galleryReconciliation.run(batchSize);
      else await galleryRollback.reconcileDisabled();
      await module.run({
        workType: "content_bundle_deletions",
        olderThan: new Date(),
        limit: batchSize,
      });
    } catch (error) {
      apiLogger.emit({
        severity: "ERROR",
        body: "Artifact and content bundle deletion cleanup failed.",
        eventName: "shareslices.reconciliation.deletion.cleanup_failed",
        attributes: exceptionAttributes(error),
      });
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), intervalMilliseconds);
  timer.unref();
  return () => clearInterval(timer);
}
