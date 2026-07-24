import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("./", import.meta.url);

test("keeps dynamic routes ahead of the colliding asset and SPA fallback", async () => {
  const config = JSON.parse(
    await readFile(new URL("wrangler.json", root), "utf8"),
  );
  assert.equal(config.preview_urls, false);
  assert.equal("routes" in config, false);
  assert.equal("triggers" in config, false);
  assert.deepEqual(config.assets.run_worker_first, [
    "/api/*",
    "/runtime-config.json",
  ]);
  assert.equal(config.assets.not_found_handling, "single-page-application");
});

test("declares immutable browser caching only for hashed prototype assets", async () => {
  assert.equal(
    (await readFile(new URL("public/_headers", root), "utf8")).trimEnd(),
    "/assets/*\n  Cache-Control: public, max-age=31536000, immutable",
  );
});
