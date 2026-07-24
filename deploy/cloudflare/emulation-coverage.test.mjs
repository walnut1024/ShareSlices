import assert from "node:assert/strict";
import {access, readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const coverage = JSON.parse(
  await readFile(new URL("./emulation-coverage.json", import.meta.url), "utf8"),
);

test("classifies every Cloudflare verification surface without invented emulation", async () => {
  assert.equal(
    coverage.schemaVersion,
    "shareslices.cloudflare-emulation-coverage/v1",
  );
  assert.ok(Array.isArray(coverage.rows));
  assert.equal(
    new Set(coverage.rows.map(({id}) => id)).size,
    coverage.rows.length,
  );
  for (const row of coverage.rows) {
    assert.match(row.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(
      ["local-contract", "staging-required"].includes(row.classification),
    );
    if (row.classification === "local-contract") {
      assert.ok(Array.isArray(row.evidence) && row.evidence.length > 0);
      assert.equal("reasonCode" in row, false);
      for (const path of row.evidence) {
        assert.equal(path.startsWith("/"), false);
        assert.equal(path.includes(".."), false);
        await access(new URL(path, `file://${repositoryRoot}/`));
      }
    } else {
      assert.match(row.reasonCode, /^[a-z0-9_]+$/);
      assert.equal("evidence" in row, false);
      if (row.providerEvidence) {
        assert.ok(
          ["verified", "provisional"].includes(row.providerEvidence.status),
        );
        assert.ok(
          Array.isArray(row.providerEvidence.paths) &&
            row.providerEvidence.paths.length > 0,
        );
        for (const path of row.providerEvidence.paths) {
          assert.equal(path.startsWith("/"), false);
          assert.equal(path.includes(".."), false);
          await access(new URL(path, `file://${repositoryRoot}/`));
        }
      }
    }
  }
});

test("distinguishes staging necessity from current provider evidence", () => {
  const statuses = new Map(
    coverage.rows
      .filter(({classification}) => classification === "staging-required")
      .map(({id, providerEvidence}) => [
        id,
        providerEvidence?.status ?? "missing",
      ]),
  );
  assert.equal(statuses.get("r2-private-streaming-and-range"), "verified");
  assert.equal(
    statuses.get("queue-cron-control-plane-and-propagation"),
    "provisional",
  );
  assert.equal(statuses.get("container-runtime-isolation-and-rollout"), "missing");
  assert.equal(statuses.get("custom-domain-and-distinct-site-routing"), "missing");
});

test("keeps provider-only behavior out of local qualification", () => {
  const staging = new Set(
    coverage.rows
      .filter(({classification}) => classification === "staging-required")
      .map(({id}) => id),
  );
  assert.deepEqual(staging, new Set([
    "container-runtime-isolation-and-rollout",
    "custom-domain-and-distinct-site-routing",
    "hyperdrive-origin-tls-freshness-and-budget",
    "queue-cron-control-plane-and-propagation",
    "r2-private-streaming-and-range",
    "static-assets-edge-precedence-and-headers",
    "version-deployment-and-external-override",
    "worker-runtime-bundle-compatibility",
  ]));
});
