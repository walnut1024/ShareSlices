import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse } from "yaml";

const workflow = async (name) => {
  const source = await readFile(
    new URL(`../.github/workflows/${name}`, import.meta.url),
    "utf8",
  );
  return { source, document: parse(source) };
};

test("application release delegates build and publication policy to mise tasks", async () => {
  const { source, document } = await workflow("application-release.yml");
  const steps = document.jobs.build.steps;
  const commands = steps.flatMap((step) => (step.run ? [step.run] : []));
  assert.ok(commands.some((command) => command.includes("mise run check")));
  for (const task of [
    "build-static-assets",
    "cloudflare-build-workers",
    "cloudflare-build-container-images",
    "kubernetes-build-images",
  ]) {
    assert.ok(commands.some((command) => command.includes(`mise run ${task}`)));
  }
  const registry = steps.find(({ name }) => name === "Resolve OCI registry");
  assert.match(registry.run, /GITHUB_OUTPUT/);
  const login = steps.find(({ name }) => name === "Authenticate OCI publication");
  assert.equal(login.uses, "docker/login-action@v3");
  assert.equal(login.with.registry, "${{ steps.registry.outputs.host }}");
  assert.match(login.with.username, /OCI_REGISTRY_USERNAME/);
  assert.match(login.with.password, /OCI_REGISTRY_TOKEN/);
  assert.equal(document.permissions.packages, "write");
  assert.equal(document.jobs.build["runs-on"], "ubuntu-24.04");
  assert.equal(
    steps.find(({ uses }) => uses === "pnpm/action-setup@v4").uses,
    "pnpm/action-setup@v4",
  );
  const setupUv = steps.find(({ uses }) =>
    uses === "astral-sh/setup-uv@08807647e7069bb48b6ef5acd8ec9567f424441b"
  );
  assert.equal(setupUv.with["enable-cache"], false);
  assert.equal(setupUv.with.version, "0.11.16");
  assert.equal(
    steps.find(({ uses }) => uses === "docker/setup-buildx-action@v3").uses,
    "docker/setup-buildx-action@v3",
  );
  assert.doesNotMatch(source, /\b(?:docker|kubectl|kustomize|terraform|wrangler)\s/);
});

test("target workflow serializes one environment and calls only the lifecycle entrypoint", async () => {
  const { source, document } = await workflow("target-deployment.yml");
  assert.equal(document.concurrency["cancel-in-progress"], false);
  assert.deepEqual(document.jobs.deploy["runs-on"], ["self-hosted", "shareslices-deploy"]);
  const lifecycle = document.jobs.deploy.steps.find(({ name }) =>
    name === "Run repository deployment lifecycle"
  );
  assert.match(lifecycle.run, /mise run deploy/);
  assert.doesNotMatch(source, /\b(?:docker|kubectl|kustomize|terraform|wrangler)\s/);
});
