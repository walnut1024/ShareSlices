// cspell:ignore chakra
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { interfaceExceptions } from "./interface-conformance-rules.mjs"

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourceRoot = path.join(webRoot, "src")

const rules = [
  {
    id: "primitive-import",
    pattern: /from\s+["'](?:@radix-ui|@headlessui|@mui|antd|@chakra-ui|@base-ui)\b/g,
    message: "Business source must use local shadcn components instead of a primitive stack directly.",
  },
  {
    id: "raw-button",
    pattern: /<button\b/g,
    message: "Ordinary actions must use the local Button component.",
  },
  {
    id: "raw-palette",
    pattern: /\b(?:bg|text|border)-(?:neutral|gray|slate|zinc|stone|red|green|blue|amber)-[0-9]{2,3}(?:\/[0-9]{1,3})?\b/g,
    message: "Application presentation must use semantic tokens or a checked content-boundary exception.",
  },
  {
    id: "space-utility",
    pattern: /\bspace-[xy]-[^\s"']+/g,
    message: "Use flex or grid gap utilities instead of space-x/space-y.",
  },
  {
    id: "conditional-class",
    pattern: /className=\{`[^`]*\$\{/gs,
    message: "Conditional or merged classes must use cn().",
  },
]

function isBusinessSource(relativePath) {
  return relativePath.endsWith(".tsx")
    && !relativePath.startsWith("src/components/ui/")
    && !relativePath.endsWith(".test.tsx")
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(absolutePath))
    else files.push(absolutePath)
  }
  return files
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length
}

function excepted(file, rule, context) {
  return interfaceExceptions.some((exception) => exception.file === file
    && exception.rule === rule
    && context.includes(exception.match))
}

function pushFinding(findings, file, source, rule, match, index, message) {
  const lineStart = source.lastIndexOf("\n", index) + 1
  const lineEnd = source.indexOf("\n", index)
  const context = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd)
  if (excepted(file, rule, context)) return
  findings.push({ file, line: lineAt(source, index), rule, match, message })
}

export async function scanInterface(root = sourceRoot) {
  const findings = []
  const files = await walk(root)
  for (const absolutePath of files) {
    const relativePath = path.relative(webRoot, absolutePath).split(path.sep).join("/")
    if (!isBusinessSource(relativePath)) continue
    const source = await readFile(absolutePath, "utf8")

    for (const rule of rules) {
      for (const match of source.matchAll(rule.pattern)) {
        pushFinding(findings, relativePath, source, rule.id, match[0], match.index, rule.message)
      }
    }

    for (const match of source.matchAll(/className=["']([^"']*)["']/g)) {
      const tokens = match[1].split(/\s+/)
      const heights = new Set(tokens.filter((token) => /^h-/.test(token)).map((token) => token.slice(2)))
      const duplicate = tokens.find((token) => /^w-/.test(token) && heights.has(token.slice(2)))
      if (duplicate) pushFinding(findings, relativePath, source, "equal-dimensions", match[0], match.index, "Use size-* when width and height are equal.")
    }

    const structuralRules = [
      ["<SelectItem", "<SelectGroup", "select-group", "SelectItem must be composed inside SelectGroup."],
      ["<DropdownMenuItem", "<DropdownMenuGroup", "menu-group", "DropdownMenuItem must be composed inside DropdownMenuGroup."],
      ["<DialogContent", "<DialogTitle", "dialog-title", "Each file that renders DialogContent must provide DialogTitle."],
      ["<Avatar", "<AvatarFallback", "avatar-fallback", "Each identity Avatar must provide AvatarFallback."],
    ]
    for (const [needle, required, rule, message] of structuralRules) {
      if (source.includes(needle) && !source.includes(required)) {
        pushFinding(findings, relativePath, source, rule, needle, source.indexOf(needle), message)
      }
    }
  }
  return findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)
}

async function main() {
  const args = process.argv.slice(2)
  const reportOnly = args.includes("--report-only")
  const outputIndex = args.indexOf("--output")
  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null
  const findings = await scanInterface()
  const report = { generatedAt: new Date().toISOString(), findings }
  if (outputPath) await writeFile(path.resolve(process.cwd(), outputPath), `${JSON.stringify(report, null, 2)}\n`)
  for (const finding of findings) {
    process.stdout.write(`${finding.file}:${finding.line} [${finding.rule}] ${finding.message}\n`)
  }
  process.stdout.write(`${findings.length} interface conformance finding(s).\n`)
  if (findings.length > 0 && !reportOnly) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
