import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDistinctTestBrowserSites,
  assertEndpointLayerUnchanged,
  freezeEndpointLayerIdentity,
  freezeTestEndpoints,
  runtimeEnvironmentContents,
} from "./test-endpoints.mjs";

function records() {
  const bindings = [
    ["postgres", 5432, 49101],
    ["test-ingress", 8080, 49102],
    ["mailpit", 8025, 49103],
    ["object-storage", 9000, 49104],
    ["mailpit", 1025, 49105],
  ];
  const byService = new Map();
  for (const [Service, TargetPort, PublishedPort] of bindings) {
    const record = byService.get(Service) ?? {
      ID: `${Service}-container-id`,
      Service,
      State: "running",
      Publishers: [],
    };
    record.Publishers.push({ URL: "127.0.0.1", TargetPort, PublishedPort });
    byService.set(Service, record);
  }
  return [...byService.values()];
}

test("freezes Engine-assigned dependency and distinct-site ingress endpoints", () => {
  const endpoints = freezeTestEndpoints(records());
  assert.equal(endpoints.database.port, 49101);
  assert.equal(endpoints.apiOrigin, "http://app.localhost:49102");
  assert.equal(endpoints.apiTestOrigin, "http://api.localhost:49102");
  assert.equal(endpoints.contentOrigin, "http://content.localhost:49102");
  assert.equal(Object.isFrozen(endpoints), true);
  assert.match(runtimeEnvironmentContents(endpoints), /WEB_CANONICAL_HOST=app\.localhost/);
});

test("proves phase two preserves endpoint containers and published ports", () => {
  const phaseOne = records();
  const phaseTwo = [
    ...records(),
    { ID: "api-container-id", Service: "api", State: "running", Publishers: [] },
    { ID: "web-container-id", Service: "web", State: "running", Publishers: [] },
  ];
  assert.deepEqual(freezeEndpointLayerIdentity(phaseOne), {
    mailpit: "mailpit-container-id",
    "object-storage": "object-storage-container-id",
    postgres: "postgres-container-id",
    "test-ingress": "test-ingress-container-id",
  });
  assert.doesNotThrow(() => assertEndpointLayerUnchanged(phaseOne, phaseTwo));

  const recreated = records();
  recreated.find((record) => record.Service === "test-ingress").ID = "replacement-id";
  assert.throws(
    () => assertEndpointLayerUnchanged(phaseOne, recreated),
    /test-ingress was recreated/,
  );

  const rebound = records();
  rebound.find((record) => record.Service === "mailpit").Publishers[0].PublishedPort = 49203;
  assert.throws(
    () => assertEndpointLayerUnchanged(phaseOne, rebound),
    /mailpit changed/,
  );
});

test("rejects missing, duplicate, non-loopback, and non-running bindings", () => {
  const missing = records().filter((record) => record.Service !== "postgres");
  assert.throws(() => freezeTestEndpoints(missing), /postgres is not running/);

  const duplicatePort = records();
  duplicatePort.find((record) => record.Service === "mailpit").Publishers[1].PublishedPort = 49101;
  assert.throws(() => freezeTestEndpoints(duplicatePort), /multiple test endpoints/);

  const publicBinding = records();
  publicBinding[0].Publishers[0].URL = "0.0.0.0";
  assert.throws(() => freezeTestEndpoints(publicBinding), /not caller-loopback-only/);

  const stopped = records();
  stopped[0].State = "exited";
  assert.throws(() => freezeTestEndpoints(stopped), /not running/);
});

test("rejects same-host different-port and developer-default test endpoints", () => {
  const endpoints = freezeTestEndpoints(records());
  assert.throws(
    () => assertDistinctTestBrowserSites({
      ...endpoints,
      contentOrigin: `http://app.localhost:${endpoints.ingress.port + 1}`,
    }),
    /same host on different ports/,
  );

  const developerPort = records();
  developerPort.find((record) => record.Service === "postgres")
    .Publishers[0].PublishedPort = 5432;
  assert.throws(
    () => freezeTestEndpoints(developerPort),
    /reused developer-default port 5432/,
  );

  assert.throws(
    () => assertDistinctTestBrowserSites({
      ...endpoints,
      contentOrigin: `http://other.localhost:${endpoints.ingress.port}`,
    }),
    /isolated app\.localhost and content\.localhost browser sites/,
  );
});
