import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

test("private prerequisites use pinned resources and fail-closed database settings", async () => {
  const [versions, main] = await Promise.all([
    source("versions.tf"),
    source("main.tf"),
  ]);
  assert.match(versions, /required_version\s*=\s*"= 1\.15\.7"/);
  assert.match(versions, /version\s*=\s*"= 5\.22\.0"/);
  assert.match(versions, /backend "s3"/);
  assert.equal((main.match(/resource "cloudflare_r2_bucket"/g) ?? []).length, 2);
  assert.equal((main.match(/resource "cloudflare_queue"/g) ?? []).length, 2);
  assert.equal((main.match(/resource "cloudflare_hyperdrive_config"/g) ?? []).length, 1);
  assert.match(main, /disabled\s*=\s*true/);
  assert.match(main, /sslmode\s*=\s*"verify-full"/);
  assert.doesNotMatch(main, /cloudflare_queue_consumer|cloudflare_workers_cron_trigger/);
  assert.doesNotMatch(main, /delivery_paused/);
});

test("ingress remains a distinct disabled-by-default activation phase", async () => {
  const [variables, main] = await Promise.all([
    source("variables.tf"),
    source("main.tf"),
  ]);
  assert.match(variables, /variable "activate_ingress"[\s\S]*?default\s*=\s*false/);
  assert.match(main, /cloudflare_workers_custom_domain/);
  assert.match(main, /cloudflare_workers_route/);
  assert.equal(
    (main.match(/for_each\s*=\s*var\.activate_ingress/g) ?? []).length,
    2,
  );
});

test("state runbook treats state and plans as Secret-bearing recovery data", async () => {
  const readme = await source("README.md");
  for (const requirement of [
    "encryption at rest and in transit",
    "access restricted to deployment operators",
    "Hyperdrive origin password",
    "refresh-only plan",
  ]) {
    assert.ok(readme.includes(requirement), requirement);
  }
  assert.match(readme, /Import any\s+pre-existing named resource/);
});
