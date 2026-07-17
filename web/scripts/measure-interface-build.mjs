import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { gzipSync } from "node:zlib"
import path from "node:path"

const args = process.argv.slice(2)
const outputIndex = args.indexOf("--output")
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null
if (!outputPath) throw new Error("Usage: node scripts/measure-interface-build.mjs --output <path>")
const baselineIndex = args.indexOf("--baseline")
const baselinePath = baselineIndex >= 0 ? args[baselineIndex + 1] : null

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
  surfaceAssets: {
    website: assets.filter(({ name }) => /(?:HomePage|BrowsePage|PublicSite)/.test(name)).map(({ name }) => name),
    console: assets.filter(({ name }) => /(?:Console|ArtifactsPage|ArtifactPage|GalleryProfile)/.test(name)).map(({ name }) => name),
    preview: assets.filter(({ name }) => /ArtifactPreview/.test(name)).map(({ name }) => name),
    administration: assets.filter(({ name }) => /Administration/.test(name)).map(({ name }) => name),
  },
  browser: { status: "collected-by-interface-benchmark", scenarios: [] },
}
if (baselinePath) {
  const baseline = JSON.parse(await readFile(path.resolve(process.cwd(), baselinePath), "utf8"))
  report.delta = {
    javascriptRawBytes: report.totals.javascript.rawBytes - baseline.totals.javascript.rawBytes,
    javascriptGzipBytes: report.totals.javascript.gzipBytes - baseline.totals.javascript.gzipBytes,
    cssRawBytes: report.totals.css.rawBytes - baseline.totals.css.rawBytes,
    cssGzipBytes: report.totals.css.gzipBytes - baseline.totals.css.gzipBytes,
  }
}
const resolvedOutput = path.resolve(process.cwd(), outputPath)
await mkdir(path.dirname(resolvedOutput), { recursive: true })
await writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(report.totals)}\n`)
