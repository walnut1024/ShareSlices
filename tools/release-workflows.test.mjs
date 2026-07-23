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
    "kubernetes-build-images",
  ]) {
    assert.ok(commands.some((command) => command.includes(`mise run ${task}`)));
  }
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

