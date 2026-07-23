import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DeploymentConfigError,
  discoverPrerequisites,
  loadDeploymentConfig,
  validateDeploymentConfig,
} from "./config.mjs";

const fixtures = new URL("../contract/fixtures/", import.meta.url);
const readFixture = async (name) => JSON.parse(await readFile(new URL(name, fixtures), "utf8"));

test("loads one selected target and discovers only non-secret prerequisites", async () => {
  const kubernetes = await loadDeploymentConfig(new URL("deployment.kubernetes.valid.json", fixtures));
  const cloudflare = await loadDeploymentConfig(new URL("deployment.cloudflare.valid.json", fixtures));

  assert.equal(kubernetes.target, "kubernetes");
  assert.deepEqual(discoverPrerequisites(kubernetes).tools, ["kubectl", "kustomize"]);
  assert.equal(discoverPrerequisites(kubernetes).capabilities.includes("enterprise-smtp"), true);
  assert.equal(cloudflare.target, "cloudflare");
  assert.equal(cloudflare.cloudflare.edgeCdn.mode, "web-assets-only");
  assert.deepEqual(discoverPrerequisites(cloudflare).tools, ["terraform", "wrangler"]);
  assert.equal(discoverPrerequisites(cloudflare).capabilities.includes("resend-https"), true);
  assert.equal(
    discoverPrerequisites(cloudflare).secretReferences.every(({ ref, revision }) => ref.includes("://") && revision.length > 0),
    true,
  );
  assert.equal(discoverPrerequisites(cloudflare).secretReferences.length, 8);
});

test("rejects unsupported schema versions before target discovery", async () => {
  const config = await readFixture("deployment.cloudflare.valid.json");
  config.schemaVersion = "shareslices.deployment/v2";
  await assert.rejects(
    validateDeploymentConfig(config),
    (error) => error instanceof DeploymentConfigError && error.code === "deployment_schema_version_unsupported",
  );
});

test("rejects mixed targets, Compose, embedded Secrets, and wrong email Adapters", async () => {
  const kubernetes = await readFixture("deployment.kubernetes.valid.json");
  const cloudflare = await readFixture("deployment.cloudflare.valid.json");
  const invalid = [
    { ...kubernetes, target: "compose" },
    { ...kubernetes, cloudflare: cloudflare.cloudflare },
    {
      ...cloudflare,
      cloudflare: {
        ...cloudflare.cloudflare,
        email: { adapter: "smtp", resend: cloudflare.cloudflare.email.resend },
      },
    },
    {
      ...cloudflare,
      cloudflare: {
        ...cloudflare.cloudflare,
        email: { ...cloudflare.cloudflare.email, apiKey: "must-not-be-accepted" },
      },
    },
    {
      ...cloudflare,
      cloudflare: {
        ...cloudflare.cloudflare,
        edgeCdn: { mode: "cache-everything" },
      },
    },
  ];
  for (const config of invalid) {
    await assert.rejects(
      validateDeploymentConfig(config),
      (error) => error instanceof DeploymentConfigError && error.code === "deployment_config_invalid",
    );
  }
});

test("returns stable read and JSON errors without leaking file contents", async () => {
  await assert.rejects(
    loadDeploymentConfig(new URL("missing.json", fixtures)),
    (error) => error.code === "deployment_config_unreadable" && !error.message.includes("missing.json"),
  );
});

test("external CDN requires distinct public edge and private origin addresses", async () => {
  const config = await readFixture("deployment.kubernetes.valid.json");
  config.kubernetes.ingress.externalCdn.originOrigins.application = config.shared.publicOrigins.application;
  await assert.rejects(
    validateDeploymentConfig(config),
    (error) => error instanceof DeploymentConfigError &&
      error.code === "deployment_config_invalid" &&
      error.message.includes("distinct"),
  );
});

test("both production targets require distinct application and content sites", async () => {
  for (const name of [
    "deployment.kubernetes.valid.json",
    "deployment.cloudflare.valid.json",
  ]) {
    const config = await readFixture(name);
    config.shared.publicOrigins.content = "https://content.example.test";
    await assert.rejects(
      validateDeploymentConfig(config),
      (error) => error instanceof DeploymentConfigError &&
        error.code === "deployment_config_invalid" &&
        error.message.includes("registrable sites"),
    );
  }
});

test("Gallery Cookie and challenge readiness are bound to declared site evidence", async () => {
  const wrongCookie = await readFixture("deployment.cloudflare.valid.json");
  wrongCookie.shared.gallery.managementCookieDomain = "example-content.test";
  await assert.rejects(
    validateDeploymentConfig(wrongCookie),
    (error) => error instanceof DeploymentConfigError &&
      error.message.includes("Cookie domain"),
  );

  const unprovenChallenge = await readFixture("deployment.cloudflare.valid.json");
  unprovenChallenge.shared.gallery.challengeVerifierReady = true;
  await assert.rejects(
    validateDeploymentConfig(unprovenChallenge),
    (error) => error instanceof DeploymentConfigError &&
      error.message.includes("Turnstile"),
  );
});

test("session signing-key revisions are valid Better Auth key versions", async () => {
  for (const revisions of [["current"], ["0"], ["4", "4"]]) {
    const config = await readFixture("deployment.cloudflare.valid.json");
    config.shared.sessionSigningKeys = revisions.map((revision, index) => ({
      ref: `secret://workers/signing-${index}`,
      revision,
    }));
    await assert.rejects(
      validateDeploymentConfig(config),
      (error) =>
        error instanceof DeploymentConfigError &&
        error.message.includes("positive integers"),
    );
  }
});
