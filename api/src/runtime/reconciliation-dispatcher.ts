import { ReconciliationModule } from "../application/reconciliation/reconciliation.js";
import { createReconciliationRepository } from "../db/reconciliation-repository.js";
import { apiLogger, exceptionAttributes } from "../logging/index.js";
import { createConfiguredObjectStorage } from "../storage/index.js";

const intervalMilliseconds = 30_000;
const batchSize = 100;

export function startReconciliationDispatcher(): () => void {
  const module = new ReconciliationModule({
    repository: createReconciliationRepository(),
    storage: createConfiguredObjectStorage()
  });
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await module.run({
        workType: "artifact_deletions",
        olderThan: new Date(),
        limit: batchSize
      });
    } catch (error) {
      apiLogger.emit({
        severity: "ERROR",
        body: "Artifact deletion cleanup failed.",
        eventName: "shareslices.artifact.deletion.cleanup_failed",
        attributes: exceptionAttributes(error)
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
