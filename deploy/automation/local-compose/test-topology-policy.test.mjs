import assert from "node:assert/strict";
import test from "node:test";

import {
  loadAndValidateTestComposeModel,
  validateTestComposeModel,
} from "./test-topology-policy.mjs";

function validModel() {
  return {
    name: "shareslices-test",
    services: {
      api: {
        ports: [{ host_ip: "127.0.0.1", published: "0", target: 7456 }],
      },
      worker: {},
    },
    networks: { default: { name: "shareslices-test_default" } },
    volumes: { database: { name: "shareslices-test_database" } },
  };
}

test("accepts only loopback ports and project-scoped resources", () => {
  assert.equal(validateTestComposeModel(validModel()).name, "shareslices-test");
});

test("rejects every shared-resource escape", () => {
  const cases = [
    ["project", (model) => { model.name = "caller-project"; }],
    ["container", (model) => { model.services.api.container_name = "shared-api"; }],
    ["published port", (model) => { model.services.api.ports[0].host_ip = "0.0.0.0"; }],
    ["external network", (model) => { model.networks.default.external = true; }],
    ["named network", (model) => { model.networks.default.name = "shared-network"; }],
    ["external volume", (model) => { model.volumes.database.external = true; }],
    ["named volume", (model) => { model.volumes.database.name = "shared-volume"; }],
    ["config", (model) => { model.configs = { shared: { file: "/tmp/shared" } }; }],
    ["secret", (model) => { model.services.api.secrets = ["shared"]; }],
  ];
  for (const [name, mutate] of cases) {
    const model = validModel();
    mutate(model);
    assert.throws(() => validateTestComposeModel(model), undefined, name);
  }
});

test("loads the hermetic JSON model through the pinned Compose command", () => {
  const calls = [];
  const model = validModel();
  const result = loadAndValidateTestComposeModel({
    connectionArgs: ["--host", "unix:///docker.sock"],
    composeArgs: ["compose", "-p", "shareslices-test"],
    environment: { DOCKER_CONFIG: "/tmp/isolated", PATH: "/bin" },
    executeCommand(args, options) {
      calls.push([args, options]);
      return JSON.stringify(model);
    },
  });
  assert.deepEqual(result, model);
  assert.deepEqual(calls[0][0].slice(-3), ["config", "--format", "json"]);
  assert.deepEqual(calls[0][1].env, {
    DOCKER_CONFIG: "/tmp/isolated",
    PATH: "/bin",
  });
});
