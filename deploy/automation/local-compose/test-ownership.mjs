import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const labelPrefix = "com.shareslices.test";
const topologyFiles = Object.freeze([
  "deploy/compose/compose.yaml",
  "deploy/compose/compose.test.yaml",
]);

function digest(parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}

export function createTestOwnership({ repositoryRoot, endpoint, engineId }) {
  return Object.freeze({
    repository: digest([repositoryRoot]),
    topology: digest(topologyFiles.flatMap((path) => [
      path,
      readFileSync(`${repositoryRoot}/${path}`),
    ])),
    endpoint: digest([endpoint]),
    engine: digest([engineId]),
    project: "shareslices-test",
  });
}

export function ownershipEnvironmentContents(ownership) {
  return `${[
    ["SHARESLICES_TEST_REPOSITORY_ID", ownership.repository],
    ["SHARESLICES_TEST_TOPOLOGY_ID", ownership.topology],
    ["SHARESLICES_TEST_ENDPOINT_ID", ownership.endpoint],
    ["SHARESLICES_TEST_ENGINE_ID", ownership.engine],
  ].map(([name, value]) => `${name}=${value}`).join("\n")}\n`;
}

export function ownershipLabels(ownership) {
  return Object.freeze(Object.fromEntries(
    Object.entries(ownership).map(([name, value]) => [`${labelPrefix}.${name}`, value]),
  ));
}

function parseLines(value) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function inspectTestProjectResources({ connectionArgs, environment, executeCommand }) {
  const resources = [];
  for (const [kind, command] of [
    ["container", ["ps", "-aq"]],
    ["network", ["network", "ls", "-q"]],
    ["volume", ["volume", "ls", "-q"]],
  ]) {
    const identifiers = parseLines(executeCommand("docker", [
      ...connectionArgs,
      ...command,
      "--filter", "label=com.docker.compose.project=shareslices-test",
    ], { env: environment }));
    if (identifiers.length === 0) continue;
    const inspected = JSON.parse(executeCommand(
      "docker",
      [...connectionArgs, "inspect", ...identifiers],
      { env: environment },
    ));
    for (const resource of inspected) {
      resources.push({
        kind,
        name: resource.Name?.replace(/^\//, "") ?? resource.Id ?? "unknown",
        labels: kind === "container" ? resource.Config?.Labels ?? {} : resource.Labels ?? {},
      });
    }
  }
  return resources;
}

export function assertOwnedTestResources(resources, ownership) {
  const expected = ownershipLabels(ownership);
  for (const resource of resources) {
    for (const [name, value] of Object.entries(expected)) {
      if (resource.labels[name] !== value) {
        const actual = resource.labels[name] === undefined ? "missing" : "mismatched";
        throw new Error(
          `Stale shareslices-test ${resource.kind} ${resource.name} has ${actual} ownership marker ${name}`,
        );
      }
    }
  }
}

export function recoverOwnedTestProject({
  connectionArgs,
  environment,
  executeCommand,
  ownership,
  cleanup,
}) {
  const resources = inspectTestProjectResources({ connectionArgs, environment, executeCommand });
  if (resources.length === 0) return false;
  assertOwnedTestResources(resources, ownership);
  cleanup();
  const remaining = inspectTestProjectResources({ connectionArgs, environment, executeCommand });
  if (remaining.length !== 0) {
    const inventory = remaining
      .map(({ kind, name }) => `${kind}:${name}`)
      .sort()
      .join(", ");
    throw new Error(
      `Owned stale shareslices-test cleanup left project resources behind: ${inventory}`,
    );
  }
  return true;
}
