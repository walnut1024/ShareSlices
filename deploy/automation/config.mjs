import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { getDomain } from "tldts";

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
    if (
      getDomain(new URL(originOrigins.application).hostname) ===
      getDomain(new URL(originOrigins.content).hostname)
    ) {
      throw new DeploymentConfigError(
        "deployment_config_invalid",
        "External CDN application and content origins must use distinct registrable sites.",
      );
    }
  }
  const applicationSite = getDomain(
    new URL(value.shared.publicOrigins.application).hostname,
  );
  const contentSite = getDomain(
    new URL(value.shared.publicOrigins.content).hostname,
  );
  if (!applicationSite || !contentSite || applicationSite === contentSite) {
    throw new DeploymentConfigError(
      "deployment_config_invalid",
      "Application and content origins must use distinct registrable sites.",
    );
  }
  const gallery = value.shared.gallery;
  if (gallery.managementCookieDomain !== applicationSite) {
    throw new DeploymentConfigError(
      "deployment_config_invalid",
      "Gallery management Cookie domain must equal the application registrable site.",
    );
  }
  if (
    gallery.challengeVerifierReady &&
    (!gallery.turnstileSiteKey || !value.shared.roleSecrets.galleryTurnstile)
  ) {
    throw new DeploymentConfigError(
      "deployment_config_invalid",
      "Gallery challenge readiness requires both public and Secret Turnstile references.",
    );
  }
  if (
    !gallery.enabled &&
    Object.entries(gallery).some(
      ([name, ready]) => name.endsWith("Ready") && ready === true,
    )
  ) {
    throw new DeploymentConfigError(
      "deployment_config_invalid",
      "Disabled Gallery configuration cannot claim a ready capability.",
    );
  }
  if (value.target === "cloudflare") {
    const controls = value.cloudflare.costControls;
    const workerCpu = controls.workerCpuMilliseconds;
    if (
      ["application", "content", "jobs"].some(
        (role) => workerCpu[role] > workerCpu.operatorSafetyCap,
      )
    ) {
      throw new DeploymentConfigError(
        "deployment_config_invalid",
        "Cloudflare Worker CPU limits cannot exceed the operator safety cap.",
      );
    }
    for (const [role, container] of Object.entries(controls.containers)) {
      if (
        container.maximumInstances > container.operatorSafetyCapInstances ||
        container.runnerSlots > container.maximumInstances ||
        container.maximumConcurrency > container.runnerSlots
      ) {
        throw new DeploymentConfigError(
          "deployment_config_invalid",
          `Cloudflare ${role} Container bounds exceed the declared instance or slot safety cap.`,
        );
      }
    }
  }
  const signingVersions = value.shared.sessionSigningKeys.map(({ revision }) =>
    Number(revision),
  );
  if (
    signingVersions.some(
      (version, index) =>
        !Number.isSafeInteger(version) ||
        version <= 0 ||
        String(version) !== value.shared.sessionSigningKeys[index].revision,
    ) ||
    new Set(signingVersions).size !== signingVersions.length
  ) {
    throw new DeploymentConfigError(
      "deployment_config_invalid",
      "Session signing-key revisions must be unique positive integers.",
    );
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
  const roleSecrets = config.shared.roleSecrets;
  return [
    config.shared.database,
    ...config.shared.sessionSigningKeys,
    roleSecrets.authenticationEmailEncryption,
    roleSecrets.contentFingerprint.current,
    ...(roleSecrets.contentFingerprint.previous
      ? [roleSecrets.contentFingerprint.previous]
      : []),
    roleSecrets.idempotencyEncryption.current,
    ...(roleSecrets.idempotencyEncryption.previous
      ? [roleSecrets.idempotencyEncryption.previous]
      : []),
    ...(roleSecrets.galleryTurnstile ? [roleSecrets.galleryTurnstile] : []),
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
    secretReferences: [
      ...common.secretReferences,
      config.cloudflare.providerReadToken,
      config.cloudflare.postgresqlOrigin,
      config.cloudflare.releaseStore,
      config.cloudflare.email.resend,
    ],
    capabilities: [...common.capabilities, "workers-paid-containers", "private-r2", "resend-https"],
  });
}
