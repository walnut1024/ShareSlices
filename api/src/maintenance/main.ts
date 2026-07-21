import { startAuthenticationEmailDispatcher } from "./authentication-email-node-dispatcher.js";
import { closeDb } from "../db/client.js";
import { readMaintenanceEnv } from "../env.js";
import { apiLogger, exceptionAttributes } from "../logging/index.js";
import { startReconciliationDispatcher } from "../runtime/reconciliation-dispatcher.js";

readMaintenanceEnv();
const stopAuthenticationEmail = startAuthenticationEmailDispatcher({ keepAlive: true });
const stopReconciliation = startReconciliationDispatcher({ keepAlive: true });
let stopping = false;

async function stop(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (stopping) return;
  stopping = true;
  apiLogger.emit({
    severity: "INFO",
    body: "Maintenance shutdown requested.",
    eventName: "shareslices.maintenance.shutdown.requested",
    attributes: { "process.signal": signal },
  });
  stopAuthenticationEmail();
  stopReconciliation();
  await closeDb();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void stop(signal).catch((error) => {
      apiLogger.emit({
        severity: "FATAL",
        body: "Maintenance shutdown failed.",
        eventName: "shareslices.maintenance.shutdown.failed",
        attributes: exceptionAttributes(error),
      });
      process.exitCode = 1;
    });
  });
}

apiLogger.emit({
  severity: "INFO",
  body: "Maintenance dispatchers started.",
  eventName: "shareslices.maintenance.started",
});
