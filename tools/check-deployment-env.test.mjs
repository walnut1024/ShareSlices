import assert from "node:assert/strict";
import test from "node:test";
import { composeEnvironmentKeys, validateDeploymentConfiguration } from "./check-deployment-env.mjs";

const valid = {
  catalog: new Set(["DATABASE_URL", "API_UPSTREAM"]),
  runtime: new Set(["DATABASE_URL"]),
  deployment: new Set(["DATABASE_URL", "API_UPSTREAM"]),
  deploymentOnly: new Set(["API_UPSTREAM"])
};

test("accepts a bidirectionally owned deployment configuration", () => {
  assert.doesNotThrow(() => validateDeploymentConfiguration(valid));
});

test("rejects stale catalog and missing deployment entries", () => {
  assert.throws(
    () => validateDeploymentConfiguration({ ...valid, catalog: new Set([...valid.catalog, "REMOVED_SETTING"]) }),
    /Stale .env.example variables/
  );
  assert.throws(
    () => validateDeploymentConfiguration({ ...valid, deployment: new Set(["API_UPSTREAM"]) }),
    /Typed runtime variables are absent/
  );
});

test("rejects deployment entries without a typed or explicit deployment owner", () => {
  assert.throws(
    () => validateDeploymentConfiguration({
      ...valid,
      catalog: new Set([...valid.catalog, "UNTYPED_SETTING"]),
      deployment: new Set([...valid.deployment, "UNTYPED_SETTING"])
    }),
    /Deployment variables have no typed runtime owner/
  );
});

test("extracts interpolated and hardcoded Compose environment keys", () => {
  const compose = `services:\n  api:\n    environment:\n      DATABASE_URL: postgres://db\n      PORT: \"7456\"\n      SMTP_URL: \${SMTP_URL:-smtp://mailpit:1025}\n    ports:\n      - \"7456:7456\"\n`;
  assert.deepEqual([...composeEnvironmentKeys(compose)].sort(), ["DATABASE_URL", "PORT", "SMTP_URL"]);
});
