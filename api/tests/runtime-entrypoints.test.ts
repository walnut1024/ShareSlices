import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const source = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)),
  "utf8",
);

function resolveLocalImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const candidate = resolve(dirname(importer), specifier.replace(/\.js$/, ".ts"));
  if (existsSync(candidate)) return candidate;
  const indexCandidate = resolve(dirname(importer), specifier, "index.ts");
  return existsSync(indexCandidate) ? indexCandidate : null;
}

function reachableSources(entrypoint: string): Map<string, string> {
  const pending = [resolve(sourceRoot, entrypoint)];
  const reachable = new Map<string, string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (reachable.has(file)) continue;
    const content = readFileSync(file, "utf8");
    reachable.set(file, content);
    for (const match of content.matchAll(/(?:import|export)\s+(type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)) {
      if (match[1]) continue;
      const dependency = resolveLocalImport(file, match[2]!);
      if (dependency) pending.push(dependency);
    }
  }
  return reachable;
}

function importedEnvironmentReaders(graph: Map<string, string>): Set<string> {
  const readers = new Set<string>();
  for (const content of graph.values()) {
    for (const match of content.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'][^"']*env\.js["']/gs)) {
      for (const imported of match[1]!.split(",")) {
        const name = imported.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
        if (name?.startsWith("read")) readers.add(name);
      }
    }
  }
  return readers;
}

describe("Node runtime entrypoint authority", () => {
  it("keeps API HTTP startup free of maintenance dispatch loops", () => {
    const apiMain = source("main.ts");
    expect(apiMain).not.toContain("authentication-email-dispatcher");
    expect(apiMain).not.toContain("reconciliation-dispatcher");
    expect(apiMain).not.toContain("startAuthenticationEmailDispatcher");
    expect(apiMain).not.toContain("startReconciliationDispatcher");
  });

  it("starts both resident Node maintenance responsibilities only in maintenance", () => {
    const maintenanceMain = source("maintenance/main.ts");
    expect(maintenanceMain).toContain("readMaintenanceEnv");
    expect(maintenanceMain).toContain("startAuthenticationEmailDispatcher({ keepAlive: true })");
    expect(maintenanceMain).toContain("startReconciliationDispatcher({ keepAlive: true })");
    expect(maintenanceMain).not.toContain("@hono/node-server");
    expect(maintenanceMain).not.toContain("buildApp");
  });

  it("binds each Node entrypoint to only its role schema", () => {
    expect(source("main.ts")).toContain("readApiHttpEnv");
    expect(source("maintenance/main.ts")).not.toContain("readApiHttpEnv");
    expect(source("content/main.ts")).toContain("readContentEnv");
    expect(source("db/migrate.ts")).toContain("readMigrationEnv");

    for (const [entrypoint, forbiddenReaders] of [
      ["main.ts", ["readMaintenanceEnv", "readContentEnv", "readMigrationEnv"]],
      ["content/main.ts", ["readApiHttpEnv", "readMaintenanceEnv", "readMigrationEnv"]],
      ["db/migrate.ts", ["readApiHttpEnv", "readMaintenanceEnv", "readContentEnv"]],
    ] as const) {
      const entrypointSource = source(entrypoint);
      for (const forbidden of forbiddenReaders) expect(entrypointSource).not.toContain(forbidden);
    }
  });

  it("keeps transitive role configuration out of unrelated Node entrypoints", () => {
    const roleReaders = {
      "main.ts": ["readApiHttpEnv"],
      "maintenance/main.ts": ["readMaintenanceEnv"],
      "content/main.ts": ["readContentEnv"],
      "db/migrate.ts": ["readMigrationEnv"],
    } as const;
    const narrowReaders = new Set([
      "readDatabaseEnv",
      "readIdempotencyEnv",
      "readRuntimeEnv",
      "readStorageEnv",
    ]);

    for (const [entrypoint, allowedRoleReaders] of Object.entries(roleReaders)) {
      const allowed = new Set([...allowedRoleReaders, ...narrowReaders]);
      const observed = importedEnvironmentReaders(reachableSources(entrypoint));
      expect([...observed].filter((reader) => !allowed.has(reader))).toEqual([]);
      expect(observed.has(allowedRoleReaders[0])).toBe(true);
    }
  });

  it("keeps the content-only dependency graph free of management authority", () => {
    const graph = reachableSources("content/main.ts");
    const paths = [...graph.keys()].map((file) => file.slice(sourceRoot.length));
    expect(paths.filter((path) => /^(auth|email|http|maintenance)\//.test(path))).toEqual([]);
    expect(paths.filter((path) => path.startsWith("application/accounts/"))).toEqual([]);
    expect(paths.filter((path) => path.includes("reconciliation-dispatcher"))).toEqual([]);
    expect(importedEnvironmentReaders(graph)).toEqual(new Set([
      "readContentEnv",
      "readDatabaseEnv",
      "readStorageEnv",
    ]));
  });

  it("keeps the trusted Hono builder independent from Node and infrastructure composition", () => {
    const graph = reachableSources("http/trusted-app.ts");
    const paths = [...graph.keys()].map((file) => file.slice(sourceRoot.length));
    expect(paths.filter((path) => /^(auth|db|email|maintenance|storage)\//.test(path))).toEqual([]);
    expect(paths.filter((path) => path === "env.ts" || path === "main.ts")).toEqual([]);
    for (const content of graph.values()) {
      expect(content).not.toContain("@hono/node-server");
      expect(content).not.toContain("node:");
    }
    expect(importedEnvironmentReaders(graph)).toEqual(new Set());
  });

  it("keeps reusable system and CLI routes free of Node infrastructure defaults", () => {
    for (const entrypoint of [
      "http/system-routes.ts",
      "http/cli-auth-routes.ts",
      "http/account-routes.ts",
      "http/artifact-routes.ts",
      "http/publication-viewer-routes.ts",
      "http/gallery-routes.ts",
    ]) {
      const graph = reachableSources(entrypoint);
      const paths = [...graph.keys()].map((file) => file.slice(sourceRoot.length));
      expect(paths.filter((path) => path === "env.ts" || path === "db/client.ts")).toEqual([]);
      expect(paths.filter((path) => path === "auth/auth.ts")).toEqual([]);
      expect(importedEnvironmentReaders(graph)).toEqual(new Set());
    }
  });

  it("keeps Cloudflare entrypoints free of Node startup and resident loops", () => {
    const graph = reachableSources("cloudflare/runtime.ts");
    const paths = [...graph.keys()].map((file) => file.slice(sourceRoot.length));
    expect(paths.filter((path) => path === "env.ts" || path === "main.ts")).toEqual([]);
    expect(paths.filter((path) => path.startsWith("maintenance/"))).toEqual([]);
    expect(paths.filter((path) => path.includes("dispatcher"))).toEqual([]);
    for (const content of graph.values()) {
      expect(content).not.toContain("@hono/node-server");
      expect(content).not.toContain("setInterval");
      expect(content).not.toContain("node:");
    }
    expect(importedEnvironmentReaders(graph)).toEqual(new Set());
  });

  it("keeps the concrete Cloudflare content Worker authority-reduced", () => {
    const graph = reachableSources("cloudflare/content-entrypoint.ts");
    const paths = [...graph.keys()].map((file) => file.slice(sourceRoot.length));
    expect(paths.filter((path) => /^(auth|email|http|maintenance)\//.test(path))).toEqual([]);
    expect(paths.filter((path) => path.startsWith("application/accounts/"))).toEqual([]);
    expect(paths.filter((path) => path.includes("job-outbox"))).toEqual([]);
    for (const content of graph.values()) {
      expect(content).not.toContain("@hono/node-server");
      expect(content).not.toContain("setInterval");
      expect(content).not.toContain("process.env");
      expect(content).not.toContain("node:stream");
    }
    expect(importedEnvironmentReaders(graph)).toEqual(new Set());
  });

  it("keeps Cloudflare email composition independent from process and resident startup", () => {
    const graph = reachableSources("cloudflare/authentication-email-composition.ts");
    const paths = [...graph.keys()].map((file) => file.slice(sourceRoot.length));
    expect(paths.filter((path) => path === "env.ts" || path === "db/client.ts")).toEqual([]);
    expect(paths.filter((path) => path.startsWith("maintenance/"))).toEqual([]);
    expect(paths.filter((path) => path === "logging/index.ts")).toEqual([]);
    for (const content of graph.values()) {
      expect(content).not.toContain("startAuthenticationEmailDispatcher");
      expect(content).not.toContain("process.env");
    }
    expect(importedEnvironmentReaders(graph)).toEqual(new Set());
  });

  it("keeps the reusable Better Auth composition independent from Node globals", () => {
    const graph = reachableSources("auth/create-auth.ts");
    const paths = [...graph.keys()].map((file) => file.slice(sourceRoot.length));
    expect(paths.filter((path) => path === "env.ts" || path === "db/client.ts")).toEqual([]);
    for (const content of graph.values()) {
      expect(content).not.toContain("process.env");
    }
    expect(importedEnvironmentReaders(graph)).toEqual(new Set());
  });

  it("keeps authentication email transactions injectable for Hyperdrive", () => {
    const graph = reachableSources("db/authentication-email-repository.ts");
    const paths = [...graph.keys()].map((file) => file.slice(sourceRoot.length));
    expect(paths.filter((path) => path === "env.ts" || path === "db/client.ts")).toEqual([]);
    expect(paths.filter((path) => path === "logging/index.ts")).toEqual([]);
    expect(importedEnvironmentReaders(graph)).toEqual(new Set());
  });

  it("keeps the route-free Cloudflare Jobs entrypoint bounded and environment-independent", async () => {
    const graph = reachableSources("cloudflare/jobs-entrypoint.ts");
    const paths = [...graph.keys()].map((file) => file.slice(sourceRoot.length));
    expect(paths.filter((path) => path === "env.ts" || path === "db/client.ts")).toEqual([]);
    expect(paths.filter((path) => path.startsWith("maintenance/"))).toEqual([]);
    for (const content of graph.values()) {
      expect(content).not.toContain("startAuthenticationEmailDispatcher");
      expect(content).not.toContain("setTimeout(");
      expect(content).not.toContain("process.env");
    }
    expect(importedEnvironmentReaders(graph)).toEqual(new Set());

    const worker = (await import("../src/cloudflare/jobs-entrypoint.js")).default;
    expect(Object.keys(worker).sort()).toEqual(["queue", "scheduled"]);
    expect(worker).not.toHaveProperty("fetch");
  });
});
