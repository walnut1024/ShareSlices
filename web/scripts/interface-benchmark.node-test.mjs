import assert from "node:assert/strict"
import test from "node:test"

import { interfaceBenchmarkScenarios } from "./interface-benchmark-scenarios.mjs"

test("defines six unique benchmark scenarios with routes and end locators", () => {
  assert.equal(interfaceBenchmarkScenarios.length, 6)
  assert.equal(new Set(interfaceBenchmarkScenarios.map(({ id }) => id)).size, 6)
  for (const scenario of interfaceBenchmarkScenarios) {
    assert.match(scenario.route, /^\//)
    assert.ok(scenario.endName)
  }
})
