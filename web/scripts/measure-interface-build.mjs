import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { gzipSync } from "node:zlib"
import path from "node:path"

const args = process.argv.slice(2)
const outputIndex = args.indexOf("--output")
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null
if (!outputPath) throw new Error("Usage: node scripts/measure-interface-build.mjs --output <path>")

const dist = path.resolve(process.cwd(), "dist/assets")
const names = await readdir(dist)
const assets = []
for (const name of names.sort()) {
  if (!/\.(?:js|css)$/.test(name)) continue
  const contents = await readFile(path.join(dist, name))
  assets.push({ name, type: name.endsWith(".js") ? "javascript" : "css", rawBytes: contents.byteLength, gzipBytes: gzipSync(contents).byteLength })
}
const total = (type, field) => assets.filter((asset) => asset.type === type).reduce((sum, asset) => sum + asset[field], 0)
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  assets,
  totals: {
    javascript: { rawBytes: total("javascript", "rawBytes"), gzipBytes: total("javascript", "gzipBytes") },
    css: { rawBytes: total("css", "rawBytes"), gzipBytes: total("css", "gzipBytes") },
  },
  browser: { status: "collected-by-interface-benchmark", scenarios: [] },
}
const resolvedOutput = path.resolve(process.cwd(), outputPath)
await mkdir(path.dirname(resolvedOutput), { recursive: true })
await writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(report.totals)}\n`)
