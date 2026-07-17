import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { interfaceBenchmarkScenarios } from "./interface-benchmark-scenarios.mjs"

test("defines canonical benchmark scenarios for every Web surface", () => {
  assert.equal(interfaceBenchmarkScenarios.length, 7)
  assert.equal(new Set(interfaceBenchmarkScenarios.map(({ id }) => id)).size, 7)
  for (const scenario of interfaceBenchmarkScenarios) {
    assert.match(scenario.route, /^\//)
    assert.doesNotMatch(scenario.route, /^\/artifacts(?:\/|$)/)
    assert.doesNotMatch(scenario.route, /^\/settings\/gallery-profile(?:\/|$)/)
    assert.ok(scenario.endName)
  }
})

test("keeps private surface groups behind lazy imports", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8")
  for (const moduleName of ["ConsoleRoutePage", "ArtifactPreviewPage", "AdministrationRoutePage"]) {
    assert.match(app, new RegExp(`const ${moduleName} = lazy\\(`))
    assert.doesNotMatch(app, new RegExp(`import \\{ ${moduleName} \\} from`))
  }
})

test("keeps deterministic homepage discovery requests", async () => {
  const home = await readFile(new URL("../src/screens/HomePage.tsx", import.meta.url), "utf8")
  assert.equal(home.match(/listGallery\(\{ mode: "featured", limit: 8 \}\)/g)?.length, 1)
  assert.equal(home.match(/listGallery\(\{ mode: "newest", limit: 8 \}\)/g)?.length, 1)
  assert.match(home, /if \(featured\.items\.length > 0\)[\s\S]*?return;[\s\S]*?listGallery\(\{ mode: "newest", limit: 8 \}\)/)
})
