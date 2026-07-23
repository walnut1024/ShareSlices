import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { canonicalBytes } from "../automation/canonical.mjs";

const forbiddenDependencyPatterns = Object.freeze([
  /^(?:auth|email|http|maintenance)\//,
  /^application\/accounts\//,
  /(?:^|\/)job-outbox\.ts$/,
]);

export const contentBindingContract = Object.freeze([
  Object.freeze({ name: "HYPERDRIVE", type: "hyperdrive" }),
  Object.freeze({ name: "ARTIFACTS", type: "r2_bucket" }),
  ...[
    "WEB_ORIGIN",
    "API_ORIGIN",
    "GALLERY_ENABLED",
    "GALLERY_CONTENT_ORIGIN",
    "GALLERY_CONTENT_REGISTRABLE_SITE",
    "GALLERY_MANAGEMENT_COOKIE_DOMAIN",
    "GALLERY_NETWORK_POLICY",
    "GALLERY_GRANT_REVISION",
    "GALLERY_APPEAL_POLICY_REVISION",
    "GALLERY_CHALLENGE_VERIFIER_READY",
    "GALLERY_ADMINISTRATOR_AUTHORITY_READY",
    "GALLERY_REPORTING_READY",
    "GALLERY_NOTIFICATION_READY",
    "GALLERY_APPEAL_READY",
    "GALLERY_GOVERNANCE_READY",
    "GALLERY_ISOLATED_CONTENT_READY",
    "SERVICE_VERSION",
    "DEPLOYMENT_ENVIRONMENT",
  ].map((name) => Object.freeze({ name, type: "plain_text" })),
]);

function localImport(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const candidate = resolve(dirname(importer), specifier.replace(/\.js$/, ".ts"));
  if (existsSync(candidate)) return candidate;
  const indexCandidate = resolve(dirname(importer), specifier, "index.ts");
  return existsSync(indexCandidate) ? indexCandidate : null;
}

export function contentDependencyEvidence(sourceRoot, entrypoint) {
  const pending = [resolve(sourceRoot, entrypoint)];
  const paths = new Set();
  while (pending.length > 0) {
    const path = pending.pop();
    const relativePath = relative(sourceRoot, path).split(sep).join("/");
    if (paths.has(relativePath)) continue;
    paths.add(relativePath);
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(
      /(?:import|export)\s+(type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    )) {
      if (match[1]) continue;
      const dependency = localImport(path, match[2]);
      if (dependency) pending.push(dependency);
    }
    for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
      const dependency = localImport(path, match[1]);
      if (dependency) pending.push(dependency);
    }
  }
  const dependencyPaths = [...paths].sort();
  const forbiddenDependencies = dependencyPaths.filter((path) =>
    forbiddenDependencyPatterns.some((pattern) => pattern.test(path)),
  );
  const body = {
    schemaVersion: "shareslices.cloudflare-content-authority/v1",
    entrypoint,
    dependencyPaths,
    forbiddenDependencies,
    bindingContract: contentBindingContract,
  };
  return Object.freeze({
    ...body,
    evidenceDigest: `sha256:${createHash("sha256").update(canonicalBytes(body)).digest("hex")}`,
  });
}

export function verifyDeployedContentAuthority({
  artifact,
  deployedBundleDigest,
  deployedBindings,
}) {
  if (artifact.role !== "content" || !artifact.authority) {
    throw new Error("cloudflare_content_authority_evidence_missing");
  }
  if (artifact.authority.forbiddenDependencies.length > 0) {
    throw new Error("cloudflare_content_dependency_authority_expanded");
  }
  const { evidenceDigest, ...authorityBody } = artifact.authority;
  const calculatedEvidenceDigest = `sha256:${createHash("sha256")
    .update(canonicalBytes(authorityBody))
    .digest("hex")}`;
  if (
    evidenceDigest !== calculatedEvidenceDigest ||
    deployedBundleDigest !== artifact.contentDigest
  ) {
    throw new Error("cloudflare_content_bundle_authority_mismatch");
  }
  const expected = contentBindingContract
    .map(({ name, type }) => `${type}:${name}`)
    .sort();
  const observed = deployedBindings
    .map(({ name, type }) => `${type}:${name}`)
    .sort();
  if (new Set(observed).size !== observed.length ||
      JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error("cloudflare_content_binding_authority_mismatch");
  }
  return Object.freeze({
    outcome: "passed",
    bundleDigest: artifact.contentDigest,
    authorityEvidenceDigest: evidenceDigest,
    bindingCount: observed.length,
  });
}
