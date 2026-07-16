import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const output = join(root, "package", "shareslices.skill");
const temporary = mkdtempSync(join(tmpdir(), "shareslices-skill-package-"));
const folder = join(temporary, "shareslices");
mkdirSync(folder, {recursive: true});
cpSync(join(root, "shareslices", "SKILL.md"), join(folder, "SKILL.md"), {recursive: true});
cpSync(join(root, "shareslices", "agents"), join(folder, "agents"), {recursive: true});
for (const path of [folder, join(folder, "SKILL.md"), join(folder, "agents"), join(folder, "agents", "openai.yaml")]) utimesSync(path, new Date(0), new Date(0));
const archive = join(temporary, "shareslices.skill");
const zip = spawnSync("zip", ["-X", "-q", "-r", archive, "shareslices"], {cwd: temporary, encoding: "utf8"});
if (zip.status !== 0) throw new Error(zip.stderr || "zip failed");
if (process.argv.includes("--check")) {
  if (!readFileSync(archive).equals(readFileSync(output))) throw new Error("skill/package/shareslices.skill is stale; run pnpm skill:package");
} else cpSync(archive, output);
rmSync(temporary, {recursive: true, force: true});
