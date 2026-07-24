import assert from "node:assert/strict";
import test from "node:test";

import {
  createCloudflareTerraformStateReader,
  createCloudflareWranglerDeploymentReader,
} from "./provider-readers.mjs";

test("Terraform reader extracts only state identity and outputs from Secret-bearing state", async () => {
  const calls = [];
  const reader = createCloudflareTerraformStateReader({
    directory: "/deployment/terraform",
    runCommand: (executable, arguments_) => {
      calls.push({executable, arguments_});
      return {
        status: 0,
        stdout: JSON.stringify({
          lineage: "lineage-1",
          serial: 4,
          outputs: {
            private_prerequisites: {sensitive: false, value: {account_id: "account"}},
          },
          resources: [{instances: [{attributes: {password: "must-not-return"}}]}],
        }),
        stderr: "",
      };
    },
  });
  const result = await reader();
  assert.deepEqual(calls, [{
    executable: "terraform",
    arguments_: ["-chdir=/deployment/terraform", "state", "pull"],
  }]);
  assert.deepEqual(result, {
    lineage: "lineage-1",
    serial: 4,
    outputs: {
      private_prerequisites: {sensitive: false, value: {account_id: "account"}},
    },
  });
  assert.equal(JSON.stringify(result).includes("must-not-return"), false);
});

test("Terraform reader redacts command failures and malformed state", async () => {
  for (const response of [
    {status: 1, stdout: "", stderr: "password=secret"},
    {status: 0, stdout: "not-json", stderr: ""},
  ]) {
    const reader = createCloudflareTerraformStateReader({
      runCommand: () => response,
    });
    await assert.rejects(
      reader(),
      (error) =>
        error.code === "cloudflare_terraform_state_unavailable" &&
        !error.message.includes("secret"),
    );
  }
});

test("Wrangler reader uses JSON mode and recognizes only the pinned absent-script code", async () => {
  const calls = [];
  const deployments = [{id: "deployment-1"}];
  const reader = createCloudflareWranglerDeploymentReader({
    executable: "/tools/wrangler",
    runCommand: (executable, arguments_) => {
      calls.push({executable, arguments_});
      return {
        status: 0,
        stdout: `warning\n${JSON.stringify(deployments)}`,
        stderr: "",
      };
    },
  });
  assert.deepEqual(await reader({name: "shareslices-app"}), deployments);
  assert.deepEqual(calls, [{
    executable: "/tools/wrangler",
    arguments_: [
      "deployments",
      "list",
      "--name",
      "shareslices-app",
      "--json",
    ],
  }]);

  const absent = createCloudflareWranglerDeploymentReader({
    runCommand: () => ({
      status: 1,
      stdout: "",
      stderr: "Worker does not exist. [code: 10007]",
    }),
  });
  assert.deepEqual(await absent({name: "missing"}), []);
});

test("Wrangler reader rejects other provider errors and non-array JSON", async () => {
  for (const response of [
    {status: 1, stdout: "", stderr: "denied [code: 10000] token=secret"},
    {status: 0, stdout: "{}", stderr: ""},
  ]) {
    const reader = createCloudflareWranglerDeploymentReader({
      runCommand: () => response,
    });
    await assert.rejects(
      reader({name: "worker"}),
      (error) => !error.message.includes("secret"),
    );
  }
});
