import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const skill = readFileSync(new URL("SKILL.md", root), "utf8");
const behavior = JSON.parse(readFileSync(new URL("evals/behavior.json", root), "utf8"));
const triggers = JSON.parse(readFileSync(new URL("evals/triggers.json", root), "utf8"));

assert.ok(behavior.cases.length >= 24);
assert.deepEqual(behavior.cases.slice(0, 3).map(({id}) => id), ["upload-only", "explicit-publish", "ambiguous-entry"]);
assert.equal(triggers.length, 20);
assert.equal(triggers.filter(({shouldTrigger}) => shouldTrigger).length, 10);
assert.equal(triggers.filter(({shouldTrigger}) => !shouldTrigger).length, 10);
for (const phrase of ["--agent capabilities", "--agent --agent-protocol 1", "Do not parse human output", "Never call the ShareSlices HTTP", "never turn it into Publish", "inspect durable state before any replay"]) {
  assert.ok(skill.includes(phrase), `missing Skill contract: ${phrase}`);
}
for (const phrase of ["artifact.gallery.share", "artifact.gallery.update", "artifact.gallery.withdraw", "accept_permission", "without deriving either from email"]) assert.ok(skill.includes(phrase), `missing Gallery Skill contract: ${phrase}`);
for (const id of ["gallery-profile-required", "gallery-eligible-removed-history", "gallery-replacement-unconfirmed", "gallery-replacement-confirmed", "gallery-proposal-review", "gallery-revision-conflict", "gallery-indeterminate", "gallery-capability-unsupported"]) {
  assert.ok(behavior.cases.some((testCase) => testCase.id === id), `missing Gallery safety evaluation: ${id}`);
}
for (const testCase of behavior.cases) {
  assert.ok(testCase.assertions.length >= 2, `${testCase.id} needs safety assertions`);
  if (testCase.expectedOperation === null) {
    assert.deepEqual(testCase.argv, [], `${testCase.id} must stop before CLI dispatch`);
    continue;
  }
  assert.deepEqual(testCase.argv.slice(0, 3), ["--agent", "--agent-protocol", "1"]);
  assert.ok(!testCase.argv.some((value) => ["--json", "--jq", "--template"].includes(value)));
  const directory = mkdtempSync(join(tmpdir(), "shareslices-skill-eval-"));
  const capture = join(directory, "capture.jsonl");
  const run = spawnSync(process.execPath, [new URL("evals/fake-cli.mjs", root).pathname, ...testCase.argv], {
    env: {...process.env, SHARESLICES_EVAL_CAPTURE: capture}, encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "");
  const envelope = JSON.parse(run.stdout);
  assert.equal(envelope.protocolVersion, 1);
  assert.equal(envelope.operation, testCase.expectedOperation);
  const captured = JSON.parse(readFileSync(capture, "utf8"));
  assert.deepEqual(captured.argv, testCase.argv);
}
console.log("ShareSlices Skill behavior, CLI contract, and trigger evaluations passed.");
