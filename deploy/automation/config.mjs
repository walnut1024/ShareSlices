import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const supportedSchemaVersion = "shareslices.deployment/v1";
const schemaPath = fileURLToPath(new URL("../contract/deployment.schema.json", import.meta.url));
let validatorPromise;

export class DeploymentConfigError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = "DeploymentConfigError";
    this.code = code;
    this.details = details;
  }
}

async function validator() {
  validatorPromise ??= readFile(schemaPath, "utf8").then((contents) => {
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
    addFormats(ajv);
    return ajv.compile(JSON.parse(contents));
  });
  return validatorPromise;
}

export async function validateDeploymentConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DeploymentConfigError(
      "deployment_config_invalid",
      "Deployment configuration must be a JSON object.",
    );
  }
  if (value.schemaVersion !== supportedSchemaVersion) {
    throw new DeploymentConfigError(
      "deployment_schema_version_unsupported",
      `Expected deployment schema ${supportedSchemaVersion}.`,
    );
  }
  const validate = await validator();
  if (!validate(value)) {
    throw new DeploymentConfigError(
      "deployment_config_invalid",
      "Deployment configuration does not match the selected target schema.",
      (validate.errors ?? []).map(({ instancePath, keyword }) => ({
        path: instancePath || "/",
        rule: keyword,
      })),
    );
  }
  if (value.target === "kubernetes" && value.kubernetes.ingress.externalCdn.enabled) {
    const edgeOrigins = value.shared.publicOrigins;
    const originOrigins = value.kubernetes.ingress.externalCdn.originOrigins;
    if (
      edgeOrigins.application === originOrigins.application ||
      edgeOrigins.content === originOrigins.content
    ) {
      throw new DeploymentConfigError(
        "deployment_config_invalid",
        "External CDN origin addresses must be distinct from public edge addresses.",
      );
    }
  }
  return structuredClone(value);
}

export async function loadDeploymentConfig(path) {
  if (!path) {
    throw new DeploymentConfigError(
      "deployment_config_required",
      "A deployment configuration path is required.",
    );
  }
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    throw new DeploymentConfigError(
      "deployment_config_unreadable",
      "Deployment configuration could not be read.",
    );
  }
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new DeploymentConfigError(
      "deployment_config_invalid_json",
      "Deployment configuration is not valid JSON.",
    );
  }
  return validateDeploymentConfig(value);
}

function sharedSecretReferences(config) {
  return [
    config.shared.database,
    ...config.shared.sessionSigningKeys,
  ];
}

export function discoverPrerequisites(config) {
  const common = {
    target: config.target,
    tools: [],
    secretReferences: sharedSecretReferences(config),
    capabilities: ["external-postgresql", "release-store", "deployment-journal"],
  };
  if (config.target === "kubernetes") {
    return Object.freeze({
      ...common,
      tools: ["kubectl", "kustomize"],
      secretReferences: [
        ...common.secretReferences,
        config.kubernetes.releaseStore,
        config.kubernetes.objectStorage,
        config.kubernetes.email.smtp,
      ],
      capabilities: [...common.capabilities, "kubernetes-api", "private-s3", "enterprise-smtp"],
    });
  }
  return Object.freeze({
    ...common,
    tools: ["terraform", "wrangler"],
    secretReferences: [...common.secretReferences, config.cloudflare.postgresqlOrigin, config.cloudflare.email.resend],
    capabilities: [...common.capabilities, "workers-paid-containers", "private-r2", "resend-https"],
  });
}
