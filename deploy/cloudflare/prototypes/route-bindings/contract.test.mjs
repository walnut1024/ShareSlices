import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("./", import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, root), "utf8"));

test("keeps only the disposable verifier on workers.dev", async () => {
  const [app, content, verifier] = await Promise.all([
    read("wrangler.app.json"),
    read("wrangler.content.json"),
    read("wrangler.verifier.json"),
  ]);
  assert.equal(app.workers_dev, false);
  assert.equal(content.workers_dev, false);
  assert.equal(verifier.workers_dev, true);
  assert.equal(app.preview_urls, false);
  assert.equal(content.preview_urls, false);
  assert.equal(verifier.preview_urls, false);
  assert.equal("routes" in app || "routes" in content || "routes" in verifier, false);
  assert.equal("triggers" in app || "triggers" in content || "triggers" in verifier, false);
});

test("binds the verifier to exactly the two private target Workers", async () => {
  const verifier = await read("wrangler.verifier.json");
  assert.deepEqual(verifier.services, [
    {
      binding: "APP",
      service: "shareslices-opsx-route-binding-app-20260725",
    },
    {
      binding: "CONTENT",
      service: "shareslices-opsx-route-binding-content-20260725",
    },
  ]);
});
