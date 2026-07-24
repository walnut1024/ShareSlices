import {spawnSync} from "node:child_process";
import {lookup} from "node:dns/promises";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

import {TargetAdapterError} from "../automation/target-adapter.mjs";
import {loadControlSchema} from "../automation/control-store.mjs";
import {renderCloudflareBundle} from "./render.mjs";

const baseline = JSON.parse(await readFile(
  new URL("./toolchain-baseline.json", import.meta.url),
  "utf8",
));
const ownership = JSON.parse(await readFile(
  new URL("./ownership.json", import.meta.url),
  "utf8",
));
const requiredArtifacts = Object.freeze([
  "app-worker-bundle",
  "content-worker-bundle",
  "jobs-worker-bundle",
  "static-assets",
  "trusted-processing-image",
  "thumbnail-image",
]);
const toolchainCheckPath = fileURLToPath(
  new URL("../automation/check-cloudflare-toolchain.mjs", import.meta.url),
);
const wranglerPath = fileURLToPath(
  new URL("../../node_modules/.bin/wrangler", import.meta.url),
);

function available(id, evidence = {}) {
  return Object.freeze({id, state: "available", evidence});
}

function warning(id, reasonCode, evidence = {}) {
  return Object.freeze({id, state: "warning", reasonCode, evidence});
}

function unavailable(id, reasonCode) {
  return Object.freeze({id, state: "unavailable", reasonCode});
}

function defaultCommand(executable, arguments_) {
  const result = spawnSync(executable, arguments_, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  return Object.freeze({
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  });
}

function parseJsonOutput(value) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

function defaultResolveHost(host) {
  return lookup(host, {all: true}).then((entries) => entries.map(({address}) => address));
}

async function defaultProbeTls(origin) {
  const response = await fetch(origin, {
    method: "HEAD",
    redirect: "manual",
    signal: AbortSignal.timeout(5_000),
  });
  return {status: response.status};
}

function unavailableOperation(operation) {
  return async () => {
    throw new TargetAdapterError(
      `cloudflare_${operation}_not_implemented`,
      `Cloudflare ${operation} is not implemented yet.`,
    );
  };
}

export function createCloudflareAdapter({
  runCommand = defaultCommand,
  resolveHost = defaultResolveHost,
  probeTls = defaultProbeTls,
  observeProvider,
  observeState,
  renderBundle = renderCloudflareBundle,
  ownershipMatrix = ownership,
  controlSchemaChecksum,
} = {}) {
  async function doctor({config, prerequisites, release}) {
    const checks = [];
    const toolchain = runCommand(process.execPath, [
      toolchainCheckPath,
    ]);
    const toolchainEvidence = parseJsonOutput(toolchain.stdout);
    checks.push(
      toolchain.status === 0 &&
      toolchainEvidence?.wrangler === baseline.wrangler.version &&
      toolchainEvidence?.terraformProvider === baseline.terraformProvider.version
        ? available("cloudflare-pinned-toolchain", {
            wranglerVersion: baseline.wrangler.version,
            terraformProviderVersion: baseline.terraformProvider.version,
            compatibilityDate: baseline.workersRuntime.compatibilityDate,
          })
        : unavailable("cloudflare-pinned-toolchain", "cloudflare_toolchain_baseline_mismatch"),
    );

    const terraform = runCommand("terraform", ["version", "-json"]);
    const terraformVersion = parseJsonOutput(terraform.stdout)?.terraform_version;
    checks.push(
      terraform.status === 0 && terraformVersion === "1.15.7"
        ? available("cloudflare-terraform-cli", {version: terraformVersion})
        : unavailable("cloudflare-terraform-cli", "cloudflare_terraform_cli_unavailable"),
    );

    const whoami = runCommand(wranglerPath, ["whoami", "--json"]);
    const identity = parseJsonOutput(whoami.stdout);
    const selectedAccount = identity?.accounts?.find(({id}) => id === config.cloudflare.accountId);
    checks.push(
      whoami.status === 0 && identity?.loggedIn === true && selectedAccount
        ? available("cloudflare-authenticated-account", {
            accountId: selectedAccount.id,
            authenticationType: identity.authType,
          })
        : unavailable("cloudflare-authenticated-account", "cloudflare_configured_account_unavailable"),
    );

    const secretReferences = prerequisites?.secretReferences ?? [];
    checks.push(
      secretReferences.length > 0 && secretReferences.every(
        ({ref, revision}) => typeof ref === "string" && ref.includes("://") && Boolean(revision),
      )
        ? available("cloudflare-secret-references", {
            referenceCount: secretReferences.length,
            valuesResolved: false,
          })
        : unavailable("cloudflare-secret-references", "cloudflare_secret_reference_invalid"),
    );

    for (const [role, origin] of Object.entries(config.shared.publicOrigins)) {
      const host = new URL(origin).hostname;
      try {
        const addresses = await resolveHost(host);
        checks.push(
          Array.isArray(addresses) && addresses.length > 0
            ? available(`cloudflare-dns:${role}`, {host, addressCount: addresses.length})
            : unavailable(`cloudflare-dns:${role}`, "cloudflare_dns_no_addresses"),
        );
      } catch {
        checks.push(unavailable(`cloudflare-dns:${role}`, "cloudflare_dns_resolution_failed"));
      }
      try {
        const observation = await probeTls(origin);
        checks.push(
          Number.isInteger(observation?.status) && observation.status >= 100
            ? available(`cloudflare-tls:${role}`, {origin, status: observation.status})
            : unavailable(`cloudflare-tls:${role}`, "cloudflare_tls_unavailable"),
        );
      } catch {
        checks.push(unavailable(`cloudflare-tls:${role}`, "cloudflare_tls_unavailable"));
      }
    }

    const artifactNames = new Set(release?.artifacts?.map(({name}) => name) ?? []);
    const missingArtifacts = requiredArtifacts.filter((name) => !artifactNames.has(name));
    checks.push(
      release && missingArtifacts.length === 0
        ? available("cloudflare-release-artifacts", {checkedCount: requiredArtifacts.length})
        : unavailable(
            "cloudflare-release-artifacts",
            release ? "cloudflare_release_artifact_missing" : "cloudflare_release_required",
          ),
    );

    const blockedOwnership = ownershipMatrix.fields.filter(({activationBlocked}) => activationBlocked);
    checks.push(
      blockedOwnership.length === 0
        ? available("cloudflare-field-ownership")
        : unavailable("cloudflare-field-ownership", "cloudflare_field_ownership_unqualified"),
    );

    let provider = null;
    if (typeof observeProvider === "function" && selectedAccount) {
      provider = await observeProvider({config, account: selectedAccount});
    }
    checks.push(
      provider?.workersPaid === true
        ? available("cloudflare-workers-paid", {source: "provider-observed"})
        : unavailable("cloudflare-workers-paid", "cloudflare_workers_paid_unproven"),
    );
    checks.push(
      provider?.privateR2 === true
        ? available("cloudflare-private-r2", {source: "provider-observed"})
        : unavailable("cloudflare-private-r2", "cloudflare_private_r2_unproven"),
    );
    checks.push(
      provider?.distinctSites === true
        ? available("cloudflare-distinct-registrable-sites", {source: "provider-observed"})
        : unavailable(
            "cloudflare-distinct-registrable-sites",
            "cloudflare_distinct_registrable_sites_unproven",
          ),
    );
    if (config.cloudflare.edgeCdn.mode === "web-and-public-viewer-bytes") {
      checks.push(warning("cloudflare-viewer-byte-cache-measurement", "cloudflare_cache_measurement_pending", {
        maximumViewerAssetBytes: config.cloudflare.edgeCdn.maximumViewerAssetBytes,
      }));
    }
    return Object.freeze({checks, database: provider?.database ?? null});
  }

  async function plan({config, release, bundle, bundleDigest, operation = "apply"}) {
    if (typeof observeState !== "function") {
      throw new TargetAdapterError(
        "cloudflare_plan_observation_unavailable",
        "Cloudflare planning requires authoritative control and provider observations.",
      );
    }
    const observed = await observeState({config, release, bundle});
    if (
      !observed ||
      typeof observed !== "object" ||
      typeof observed.revision !== "string" ||
      !observed.controlSchema ||
      !Array.isArray(observed.resources)
    ) {
      throw new TargetAdapterError(
        "cloudflare_plan_observation_invalid",
        "Cloudflare planning observations are incomplete.",
      );
    }
    const phases = operation === "rollback"
      ? bundle.phases.filter(({id}) => id !== "migration")
      : bundle.phases;
    const desired = {
      target: "cloudflare",
      releaseId: release.releaseId,
      bundleDigest,
      resources: phases.flatMap(({resources}) => resources.map((resource) => ({
        logicalId: resource.logicalId,
        phase: resource.phase,
        digest: resource.digest,
        owner: resource.owner,
        retention: resource.retention,
        securitySensitive: resource.securitySensitive,
        durable: resource.retention === "durable",
      }))),
    };
    const refusalReasons = [];
    if (ownershipMatrix.fields.some(({activationBlocked}) => activationBlocked)) {
      refusalReasons.push("cloudflare_field_ownership_unqualified");
    }
    if (operation === "rollback" && release.configurationDigest !== bundle.configurationDigest) {
      refusalReasons.push("rollback_configuration_digest_mismatch");
    }
    return Object.freeze({
      desired,
      observed,
      controlSchemaChecksum: controlSchemaChecksum ?? (await loadControlSchema()).checksum,
      refusalReasons,
    });
  }

  return Object.freeze({
    doctor,
    render: ({config, release}) => renderBundle({config, release}),
    plan,
    apply: unavailableOperation("apply"),
    status: unavailableOperation("status"),
    verify: unavailableOperation("verify"),
    rollback: unavailableOperation("rollback"),
  });
}
