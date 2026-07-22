import { readFileSync } from "node:fs";

import {runCoreVerification} from "../verify.mjs";

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

export async function runComposeCoreVerification({fetchImplementation = fetch} = {}) {
  const fixture = readJson("fixtures/verification.compose.json");
  return runCoreVerification({
    topology: "compose",
    addresses: fixture.addresses,
    fetchImplementation,
  });
}

export function printComposeCoreVerification(evidence, write = console.log) {
  for (const check of evidence.checks) {
    const label = check.outcome === "passed" ? "pass" : check.outcome === "not_applicable" ? "skip" : "fail";
    const reason = check.reasonCode ? ` (${check.reasonCode})` : "";
    const details = check.outcome === "failed" ? ` ${JSON.stringify(check.evidence)}` : "";
    write(`${label.padEnd(6)} ${check.id.padEnd(38)} ${check.outcome}${reason}${details}`);
  }
}
