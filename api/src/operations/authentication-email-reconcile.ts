import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  reconcileAuthenticationEmailDelivery,
} from "../application/accounts/authentication-email-reconciliation.js";
import { createDatabaseConnection } from "../db/connection.js";
import { apiLogger, exceptionAttributes } from "../logging/index.js";

const configurationSchema = z.object({
  DATABASE_URL: z.string().url(),
  ACCOUNT_MAINTENANCE_PUBLIC_KEY_FILE: z.string().min(1),
  ACCOUNT_MAINTENANCE_ISSUER: z.string().min(1),
  ACCOUNT_MAINTENANCE_AUDIENCE: z.string().min(1),
  ACCOUNT_MAINTENANCE_INSTALLATION: z.string().min(1),
  ACCOUNT_MAINTENANCE_MAX_AUTHORIZATION_SECONDS: z.coerce.number().int().positive().max(900).default(300),
  ACCOUNT_MAINTENANCE_PROVIDER_SAFETY_MARGIN_SECONDS: z.coerce.number().int().nonnegative().max(3600).default(60),
});

const authorizationFileSchema = z.object({
  envelope: z.unknown(),
  signature: z.string().min(1),
}).strict();

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  source: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (argv.length !== 1) throw new Error("usage: authentication-email-reconcile <authorization.json>");
  const configuration = configurationSchema.parse(source);
  const authorization = authorizationFileSchema.parse(JSON.parse(await readFile(resolve(argv[0]!), "utf8")));
  const publicKeyPem = await readFile(resolve(configuration.ACCOUNT_MAINTENANCE_PUBLIC_KEY_FILE), "utf8");
  const connection = createDatabaseConnection({
    mode: "node-direct",
    connectionString: configuration.DATABASE_URL,
    maxConnections: 1,
  });
  try {
    const result = await reconcileAuthenticationEmailDelivery({
      ...authorization,
      publicKeyPem,
      issuer: configuration.ACCOUNT_MAINTENANCE_ISSUER,
      audience: configuration.ACCOUNT_MAINTENANCE_AUDIENCE,
      installation: configuration.ACCOUNT_MAINTENANCE_INSTALLATION,
      maximumLifetimeSeconds: configuration.ACCOUNT_MAINTENANCE_MAX_AUTHORIZATION_SECONDS,
      providerSafetyMarginSeconds: configuration.ACCOUNT_MAINTENANCE_PROVIDER_SAFETY_MARGIN_SECONDS,
      databaseClients: connection,
    });
    apiLogger.emit({
      severity: "INFO",
      body: "Authentication email reconciliation completed.",
      eventName: "shareslices.authentication_email.reconciliation.completed",
      attributes: {
        "shareslices.authentication_email.delivery.id": result.deliveryId,
        "shareslices.authentication_email.reconciliation.classification": result.classification,
        "shareslices.authentication_email.reconciliation.repeated": result.repeated,
      },
    });
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    apiLogger.emit({
      severity: "ERROR",
      body: "Authentication email reconciliation failed.",
      eventName: "shareslices.authentication_email.reconciliation.failed",
      attributes: exceptionAttributes(error),
    });
    process.exitCode = 1;
  });
}
