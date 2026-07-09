#!/usr/bin/env node
// Relative Markdown links must resolve to existing files. See docs/README.md.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = process.cwd();
const EXCLUDED = new Set(["node_modules", ".git", ".claude", ".codex", ".venv"]);

function collectMarkdown(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collectMarkdown(path, files);
    else if (entry.endsWith(".md")) files.push(path);
  }
  return files;
}

function stripFencedCode(text) {
  return text.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, "");
}

let failed = false;
for (const file of collectMarkdown(root)) {
  const text = stripFencedCode(readFileSync(file, "utf8"));
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // URL schemes
    if (target.startsWith("#")) continue; // in-page anchors
    const path = resolve(dirname(file), target.split("#")[0]);
    if (!existsSync(path)) {
      console.error(`${relative(root, file)}: broken link "${target}"`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log("doc links ok");
