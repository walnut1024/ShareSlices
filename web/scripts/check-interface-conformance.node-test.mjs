import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { scanInterface } from "./check-interface-conformance.mjs"

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), "shareslices-interface-"))
  await Promise.all(Object.entries(files).map(async ([name, source]) => {
    const target = path.join(root, name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, source)
  }))
  return root
}

test("accepts local components with semantic tokens", async () => {
  const root = await fixture({
    "Good.tsx": 'import { Button } from "@/components/ui/button"; export const Good=()=> <Button className="size-8 bg-background">Open</Button>',
  })
  assert.deepEqual(await scanInterface(root), [])
})

test("reports raw actions, palettes, spacing, and primitive imports", async () => {
  const root = await fixture({
    "Bad.tsx": 'import { Dialog } from "@base-ui/react/dialog"; export const Bad=()=> <div className="space-y-2 text-neutral-500"><button>Open</button></div>',
  })
  assert.deepEqual((await scanInterface(root)).map(({ rule }) => rule).sort(), [
    "primitive-import",
    "raw-button",
    "raw-palette",
    "space-utility",
  ])
})

test("reports missing composite structure", async () => {
  const root = await fixture({
    "Bad.tsx": "export const Bad=()=> <><SelectItem/><DropdownMenuItem/><DialogContent/><Avatar/></>",
  })
  assert.deepEqual((await scanInterface(root)).map(({ rule }) => rule).sort(), [
    "avatar-fallback",
    "dialog-title",
    "menu-group",
    "select-group",
  ])
})
