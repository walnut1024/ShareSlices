import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {discoverPrerequisites} from "../automation/config.mjs";
import {createCloudflareAdapter} from "./adapter.mjs";

const config = JSON.parse(await readFile(
  new URL("../contract/fixtures/deployment.cloudflare.valid.json", import.meta.url),
  "utf8",
));
const release = {
  artifacts: [
    "app-worker-bundle",
    "content-worker-bundle",
    "jobs-worker-bundle",
    "static-assets",
    "trusted-processing-image",
    "thumbnail-image",
  ].map((name) => ({name})),
};

function commandRunner(calls) {
  return (executable, arguments_) => {
    calls.push({executable, arguments_});
    if (arguments_.some((argument) => argument.endsWith("check-cloudflare-toolchain.mjs"))) {
      return {
        status: 0,
        stdout: JSON.stringify({wrangler: "4.112.0", terraformProvider: "5.22.0"}),
        stderr: "",
      };
    }
    if (executable === "terraform") {
      return {status: 0, stdout: JSON.stringify({terraform_version: "1.15.7"}), stderr: ""};
    }
    return {
      status: 0,
      stdout: `wrangler warning\n${JSON.stringify({
        loggedIn: true,
        authType: "OAuth Token",
        accounts: [{id: config.cloudflare.accountId, name: "test"}],
      })}`,
      stderr: "",
    };
  };
}

const qualifiedOwnership = {
  fields: [{id: "queue.product-consumer", owner: "wrangler", activationBlocked: false}],
};
const qualifiedDatabase = {
  hyperdrive: {
    reachable: true,
    queryCacheDisabled: true,
    tlsMode: "verify-full",
    caCertificateId: "provider-ca",
    positiveRuntimeProbe: {passed: true, evidenceId: "positive"},
    negativeIdentityProbe: {passed: true, evidenceId: "negative"},
  },
  requiredDirectRoles: ["migration", "trusted-container"],
  directConnections: ["migration", "trusted-container"].map((role) => ({
    role,
    reachable: true,
    tlsMode: "verify-full",
    caCertificateId: "provider-ca",
    positiveRuntimeProbe: {passed: true, evidenceId: `${role}-positive`},
    negativeIdentityProbe: {passed: true, evidenceId: `${role}-negative`},
  })),
};

test("doctor performs only read-only checks and returns qualified observations", async () => {
  const calls = [];
  const adapter = createCloudflareAdapter({
    runCommand: commandRunner(calls),
    resolveHost: async () => ["192.0.2.1"],
    probeTls: async () => ({status: 200}),
    ownershipMatrix: qualifiedOwnership,
    observeProvider: async ({account}) => ({
      workersPaid: true,
      privateR2: true,
      distinctSites: true,
      database: qualifiedDatabase,
      accountId: account.id,
    }),
  });

  const result = await adapter.doctor({
    config,
    prerequisites: discoverPrerequisites(config),
    release,
  });

  assert.equal(result.checks.every(({state}) => state === "available"), true);
  assert.deepEqual(result.database, qualifiedDatabase);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].arguments_.length, 1);
  assert.match(calls[0].arguments_[0], /check-cloudflare-toolchain\.mjs$/);
  assert.deepEqual(calls[1].arguments_, ["version", "-json"]);
  assert.deepEqual(calls[2].arguments_, ["whoami", "--json"]);
});

test("doctor fails closed when account, DNS, TLS, release, ownership, and provider facts are unknown", async () => {
  const adapter = createCloudflareAdapter({
    runCommand: (executable, arguments_) => {
      if (arguments_.some((argument) => argument.endsWith("check-cloudflare-toolchain.mjs"))) {
        return {
          status: 0,
          stdout: JSON.stringify({wrangler: "4.112.0", terraformProvider: "5.22.0"}),
          stderr: "",
        };
      }
      if (executable === "terraform") {
        return {status: 0, stdout: JSON.stringify({terraform_version: "1.15.7"}), stderr: ""};
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          loggedIn: true,
          accounts: [{id: "ffffffffffffffffffffffffffffffff"}],
        }),
        stderr: "",
      };
    },
    resolveHost: async () => [],
    probeTls: async () => {
      throw new Error("unreachable");
    },
  });

  const result = await adapter.doctor({
    config,
    prerequisites: discoverPrerequisites(config),
    release: null,
  });
  const unavailable = new Set(
    result.checks.filter(({state}) => state === "unavailable").map(({id}) => id),
  );
  assert.equal(unavailable.has("cloudflare-authenticated-account"), true);
  assert.equal(unavailable.has("cloudflare-dns:application"), true);
  assert.equal(unavailable.has("cloudflare-tls:content"), true);
  assert.equal(unavailable.has("cloudflare-release-artifacts"), true);
  assert.equal(unavailable.has("cloudflare-field-ownership"), true);
  assert.equal(unavailable.has("cloudflare-workers-paid"), true);
  assert.equal(unavailable.has("cloudflare-private-r2"), true);
  assert.equal(unavailable.has("cloudflare-distinct-registrable-sites"), true);
  assert.equal(JSON.stringify(result).includes("secret://"), false);
});

test("render delegates without resolving Secret values", async () => {
  const expected = {target: "cloudflare", releaseId: "release-1", phases: []};
  let received;
  const adapter = createCloudflareAdapter({
    renderBundle: async (input) => {
      received = input;
      return expected;
    },
  });
  assert.equal(await adapter.render({config, release}), expected);
  assert.deepEqual(received, {config, release});
});
