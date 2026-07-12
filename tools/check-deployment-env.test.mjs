import assert from "node:assert/strict";
import test from "node:test";
import { validateDeploymentConfiguration } from "./check-deployment-env.mjs";

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
