import assert from "node:assert/strict";
import test from "node:test";

import {
  createCloudflareContainerInstanceReader,
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

test("Container reader correlates reported instances with exact applications", async () => {
  const calls = [];
  const reader = createCloudflareContainerInstanceReader({
    executable: "/tools/wrangler",
    runCommand: (executable, arguments_) => {
      calls.push({executable, arguments_});
      if (arguments_[1] === "list") {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              id: "11111111-1111-4111-8111-111111111111",
              name: "shareslices-trusted-processing",
              image: "registry.example/trusted@sha256:1",
              version: 7,
            },
            {
              id: "22222222-2222-4222-8222-222222222222",
              name: "shareslices-thumbnail",
              image: "registry.example/thumbnail@sha256:2",
              version: 4,
            },
          ]),
          stderr: "",
        };
      }
      const trusted = arguments_[2].startsWith("1111");
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            id: trusted ? "provider-processing" : "provider-thumbnail",
            state: "running",
            version: trusted ? 7 : 4,
          },
          {
            id: `stopped-${trusted ? "processing" : "thumbnail"}`,
            state: "stopped",
            version: trusted ? 6 : 3,
          },
        ]),
        stderr: "",
      };
    },
  });
  const applications = [
    {
      name: "shareslices-trusted-processing",
      image: "registry.example/trusted@sha256:1",
      version: 7,
    },
    {
      name: "shareslices-thumbnail",
      image: "registry.example/thumbnail@sha256:2",
      version: 4,
    },
  ];
  const terminalEvidence = {
    containers: [
      {providerInstance: "provider-thumbnail"},
      {providerInstance: "provider-processing"},
    ],
  };
  assert.deepEqual(
    await reader({applications, terminalEvidence}),
    ["provider-processing", "provider-thumbnail"],
  );
  assert.deepEqual(calls.map(({arguments_}) => arguments_), [
    ["containers", "list", "--json"],
    [
      "containers",
      "instances",
      "11111111-1111-4111-8111-111111111111",
      "--json",
    ],
    [
      "containers",
      "instances",
      "22222222-2222-4222-8222-222222222222",
      "--json",
    ],
  ]);
});

test("Container reader fails closed on stale selectable versions and forged evidence", async () => {
  const applications = [{
    name: "shareslices-thumbnail",
    image: "registry.example/thumbnail@sha256:2",
    version: 4,
  }];
  const terminalEvidence = {
    containers: [{providerInstance: "provider-thumbnail"}],
  };
  const list = {
    status: 0,
    stdout: JSON.stringify([{
      id: "22222222-2222-4222-8222-222222222222",
      name: "shareslices-thumbnail",
      image: "registry.example/thumbnail@sha256:2",
      version: 4,
    }]),
    stderr: "",
  };
  for (const [instances, code] of [
    [
      [{id: "provider-thumbnail", state: "running", version: 3}],
      "cloudflare_container_previous_version_selectable",
    ],
    [
      [{id: "another-instance", state: "running", version: 4}],
      "cloudflare_container_instance_identity_mismatch",
    ],
  ]) {
    let call = 0;
    const reader = createCloudflareContainerInstanceReader({
      runCommand: () => call++ === 0
        ? list
        : {status: 0, stdout: JSON.stringify(instances), stderr: ""},
    });
    await assert.rejects(
      reader({applications, terminalEvidence}),
      {code},
    );
  }
});

test("Container reader rejects malformed provider responses without leaking stderr", async () => {
  const reader = createCloudflareContainerInstanceReader({
    runCommand: () => ({
      status: 1,
      stdout: "",
      stderr: "api-token=secret",
    }),
  });
  await assert.rejects(
    reader({
      applications: [{name: "app", image: "image", version: 1}],
      terminalEvidence: {containers: [{providerInstance: "instance"}]},
    }),
    (error) =>
      error.code === "cloudflare_container_applications_unavailable" &&
      !error.message.includes("secret"),
  );
});
