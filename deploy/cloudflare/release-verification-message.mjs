import {createHash} from "node:crypto";

import {canonicalize} from "../automation/canonical.mjs";
import {TargetAdapterError} from "../automation/target-adapter.mjs";

const WORKER_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const STABLE_SLOT = /^[a-z0-9][a-z0-9-]{0,127}$/;
const RELEASE_ID = /^sha256:[a-f0-9]{64}$/;

function fail(code, message) {
  throw new TargetAdapterError(code, message);
}

function nonEmpty(value, maximum = 512) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const child of value) deepFreeze(child);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return Object.freeze(value);
}

function identifier(prefix, parts) {
  const hash = createHash("sha256")
    .update(JSON.stringify(canonicalize(parts)), "utf8")
    .digest("hex");
  return `${prefix}_${hash}`;
}

function versionedWorker(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !WORKER_NAME.test(value.name ?? "") ||
    !nonEmpty(value.versionId, 256)
  ) {
    fail(
      "cloudflare_release_verification_message_invalid",
      `Release verification ${label} Worker identity is invalid.`,
    );
  }
  return Object.freeze({name: value.name, versionId: value.versionId});
}

function jobsWorker(value) {
  const keys = [
    "configurationDigest",
    "exportsDigest",
    "releaseBundleIdentity",
    "versionId",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== keys.join("\n") ||
    !Object.values(value).every((entry) => nonEmpty(entry))
  ) {
    fail(
      "cloudflare_release_verification_message_invalid",
      "Release verification Jobs Worker identity is invalid.",
    );
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, value[key]])));
}

function expectedContainers(releaseId, classes) {
  if (
    !classes ||
    typeof classes !== "object" ||
    Array.isArray(classes) ||
    Object.keys(classes).sort().join("\n") !==
      ["thumbnail", "trusted-processing"].join("\n")
  ) {
    fail(
      "cloudflare_release_verification_message_invalid",
      "Release verification Container classes are incomplete.",
    );
  }
  const result = [];
  for (const containerClass of ["thumbnail", "trusted-processing"]) {
    const container = classes[containerClass];
    if (
      !container ||
      typeof container !== "object" ||
      Array.isArray(container) ||
      container.releaseId !== releaseId ||
      !nonEmpty(container.buildIdentity) ||
      !nonEmpty(container.contractRevision, 256) ||
      !nonEmpty(container.imageReference) ||
      !Array.isArray(container.stableSlots) ||
      container.stableSlots.length === 0 ||
      container.stableSlots.some((slot) => !STABLE_SLOT.test(slot)) ||
      new Set(container.stableSlots).size !== container.stableSlots.length
    ) {
      fail(
        "cloudflare_release_verification_message_invalid",
        `Release verification ${containerClass} Container identity is invalid.`,
      );
    }
    for (const stableSlot of [...container.stableSlots].sort()) {
      result.push(Object.freeze({
        containerClass,
        stableSlot,
        buildIdentity: container.buildIdentity,
        contractRevision: container.contractRevision,
        imageReference: container.imageReference,
      }));
    }
  }
  return Object.freeze(result);
}

function validateExpectedContainerList(containers) {
  if (!Array.isArray(containers) || containers.length < 2) return false;
  const identities = new Set();
  const classes = new Set();
  for (const container of containers) {
    if (
      !container ||
      typeof container !== "object" ||
      Array.isArray(container) ||
      Object.keys(container).sort().join("\n") !== [
        "buildIdentity",
        "containerClass",
        "contractRevision",
        "imageReference",
        "stableSlot",
      ].join("\n") ||
      !["thumbnail", "trusted-processing"].includes(container.containerClass) ||
      !STABLE_SLOT.test(container.stableSlot ?? "") ||
      !nonEmpty(container.buildIdentity) ||
      !nonEmpty(container.contractRevision, 256) ||
      !nonEmpty(container.imageReference)
    ) {
      return false;
    }
    identities.add(`${container.containerClass}\0${container.stableSlot}`);
    classes.add(container.containerClass);
  }
  return identities.size === containers.length && classes.size === 2;
}

export function assertCloudflareReleaseVerificationMessage(
  message,
  {releaseId, fence} = {},
) {
  const expected = message?.expected;
  const lifecycle = message?.lifecycle;
  const app = expected?.appWorker;
  const content = expected?.contentWorker;
  const jobs = expected?.jobsWorker;
  const images = expected?.configuredContainerImages;
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    Object.keys(message).sort().join("\n") !== [
      "expected",
      "fence",
      "invocationId",
      "lifecycle",
      "nonce",
      "releaseId",
      "subFence",
      "version",
    ].join("\n") ||
    message.version !== 1 ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(message.invocationId ?? "") ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(message.nonce ?? "") ||
    message.releaseId !== releaseId ||
    message.fence !== fence ||
    !Number.isSafeInteger(message.subFence) ||
    message.subFence <= 0 ||
    !lifecycle ||
    typeof lifecycle !== "object" ||
    Array.isArray(lifecycle) ||
    Object.keys(lifecycle).sort().join("\n") !==
      ["quiescenceSeconds", "tombstoneSeconds"].join("\n") ||
    !Number.isSafeInteger(lifecycle.tombstoneSeconds) ||
    lifecycle.tombstoneSeconds <= 0 ||
    !Number.isSafeInteger(lifecycle.quiescenceSeconds) ||
    lifecycle.quiescenceSeconds <= 0 ||
    lifecycle.quiescenceSeconds > 11 * 60 ||
    lifecycle.quiescenceSeconds >= lifecycle.tombstoneSeconds ||
    !expected ||
    typeof expected !== "object" ||
    Array.isArray(expected) ||
    Object.keys(expected).sort().join("\n") !== [
      "appWorker",
      "configuredContainerImages",
      "containers",
      "contentWorker",
      "jobsWorker",
      "migrationHead",
    ].join("\n") ||
    !app ||
    !content ||
    Object.keys(app).sort().join("\n") !== ["name", "versionId"].join("\n") ||
    Object.keys(content).sort().join("\n") !== ["name", "versionId"].join("\n") ||
    !WORKER_NAME.test(app.name ?? "") ||
    !WORKER_NAME.test(content.name ?? "") ||
    app.name === content.name ||
    !nonEmpty(app.versionId, 256) ||
    !nonEmpty(content.versionId, 256) ||
    !jobs ||
    Object.keys(jobs).sort().join("\n") !== [
      "configurationDigest",
      "exportsDigest",
      "releaseBundleIdentity",
      "versionId",
    ].join("\n") ||
    !Object.values(jobs).every((entry) => nonEmpty(entry)) ||
    !nonEmpty(expected.migrationHead) ||
    !images ||
    Object.keys(images).sort().join("\n") !==
      ["thumbnail", "trustedProcessing"].join("\n") ||
    !nonEmpty(images.thumbnail) ||
    !nonEmpty(images.trustedProcessing) ||
    !validateExpectedContainerList(expected.containers) ||
    expected.containers.some((container) =>
      container.imageReference !== images[
        container.containerClass === "thumbnail"
          ? "thumbnail"
          : "trustedProcessing"
      ]
    )
  ) {
    fail(
      "cloudflare_release_verification_message_invalid",
      "Release verification message does not match the checked private contract.",
    );
  }
  return deepFreeze(structuredClone(message));
}

export function buildCloudflareReleaseVerificationMessage({
  lease,
  lifecycle,
  appWorker,
  contentWorker,
  jobsWorker: jobs,
  migrationHead,
  containerClasses,
} = {}) {
  if (
    !lease ||
    lease.target !== "cloudflare" ||
    !nonEmpty(lease.installationId, 63) ||
    !nonEmpty(lease.operationId, 256) ||
    !RELEASE_ID.test(lease.desiredReleaseId ?? "") ||
    !Number.isSafeInteger(lease.fencingToken) ||
    lease.fencingToken <= 0
  ) {
    fail(
      "cloudflare_release_verification_message_scope_invalid",
      "Release verification message requires an exact Cloudflare deployment lease.",
    );
  }
  if (
    !lifecycle ||
    !Number.isSafeInteger(lifecycle.tombstoneSeconds) ||
    lifecycle.tombstoneSeconds <= 0 ||
    !Number.isSafeInteger(lifecycle.quiescenceSeconds) ||
    lifecycle.quiescenceSeconds <= 0 ||
    lifecycle.quiescenceSeconds >= lifecycle.tombstoneSeconds ||
    lifecycle.quiescenceSeconds > 11 * 60
  ) {
    fail(
      "cloudflare_release_verification_message_lifecycle_invalid",
      "Release verification lifecycle bounds are invalid.",
    );
  }
  if (!nonEmpty(migrationHead)) {
    fail(
      "cloudflare_release_verification_message_invalid",
      "Release verification migration head is invalid.",
    );
  }
  const application = versionedWorker(appWorker, "App");
  const content = versionedWorker(contentWorker, "Content");
  if (application.name === content.name) {
    fail(
      "cloudflare_release_verification_message_invalid",
      "Release verification App and Content Workers must be distinct.",
    );
  }
  const releaseId = lease.desiredReleaseId;
  const containers = expectedContainers(releaseId, containerClasses);
  const nonce = identifier("nonce", {
    installationId: lease.installationId,
    operationId: lease.operationId,
    releaseId,
    fence: lease.fencingToken,
    purpose: "cloudflare-release-verification",
  });
  const invocationId = identifier("invocation", {
    nonce,
    purpose: "cloudflare-release-verification",
  });
  return assertCloudflareReleaseVerificationMessage({
    version: 1,
    invocationId,
    nonce,
    releaseId,
    fence: lease.fencingToken,
    subFence: 1,
    lifecycle: Object.freeze({
      tombstoneSeconds: lifecycle.tombstoneSeconds,
      quiescenceSeconds: lifecycle.quiescenceSeconds,
    }),
    expected: Object.freeze({
      appWorker: application,
      contentWorker: content,
      jobsWorker: jobsWorker(jobs),
      migrationHead,
      configuredContainerImages: Object.freeze({
        trustedProcessing:
          containerClasses["trusted-processing"].imageReference,
        thumbnail: containerClasses.thumbnail.imageReference,
      }),
      containers,
    }),
  }, {releaseId, fence: lease.fencingToken});
}
