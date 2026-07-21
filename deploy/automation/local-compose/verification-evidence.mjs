import { readFileSync } from "node:fs";

const contractRoot = new URL("../../contract/", import.meta.url);

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, contractRoot), "utf8"));
}

export function composeNotApplicableEvidence() {
  const projection = readJson("verification-scenarios.json");
  const fixture = readJson("fixtures/verification.compose.json");
  const scenarios = new Map(projection.scenarios.map((scenario) => [scenario.id, scenario]));
  const checks = Object.entries(fixture.expectedNotApplicable)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, reasonCode]) => {
      const scenario = scenarios.get(id);
      if (!scenario || !scenario.appliesTo.includes("compose")) {
        throw new Error(`Compose not-applicable fixture references unknown scenario ${id}`);
      }
      if (scenario.disabledExpectation !== "not_applicable" || scenario.notApplicableReason !== reasonCode) {
        throw new Error(`Compose not-applicable fixture disagrees with scenario ${id}`);
      }
      return Object.freeze({ id, outcome: "not_applicable", reasonCode });
    });
  return Object.freeze({
    schemaVersion: projection.schemaVersion,
    topology: "compose",
    checks: Object.freeze(checks),
  });
}

export function printComposeNotApplicableEvidence(write = console.log) {
  for (const check of composeNotApplicableEvidence().checks) {
    write(`skip   ${check.id.padEnd(29)} ${check.outcome} (${check.reasonCode})`);
  }
}
