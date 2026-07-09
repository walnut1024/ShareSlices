#!/usr/bin/env node
// Durable documents may only reference `mise run <task>` tasks that exist in
// .mise.toml. Disposable documents (openspec/changes/) are exempt: they may
// describe tasks they are about to create. See docs/README.md.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const EXCLUDED = new Set(["node_modules", ".git", ".claude", ".codex", ".venv"]);

function collectMarkdown(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED.has(entry)) continue;
    const path = join(dir, entry);
    const rel = relative(root, path);
    if (rel === "openspec/changes" || rel.startsWith("openspec/changes/")) continue;
    if (statSync(path).isDirectory()) collectMarkdown(path, files);
    else if (entry.endsWith(".md")) files.push(path);
  }
  return files;
}

const miseToml = readFileSync(join(root, ".mise.toml"), "utf8");
const tasks = new Set([...miseToml.matchAll(/^\[tasks\.([A-Za-z0-9:_-]+)\]/gm)].map((m) => m[1]));

let failed = false;
for (const file of collectMarkdown(root)) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/mise run ([A-Za-z0-9:_-]+)/g)) {
    if (!tasks.has(match[1])) {
      console.error(`${relative(root, file)}: references unknown mise task "${match[1]}"`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('Durable documents must only reference tasks defined in .mise.toml.');
  process.exit(1);
}
console.log(`doc refs ok (${tasks.size} known tasks)`);
