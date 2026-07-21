import assert from "node:assert/strict";
import test from "node:test";
import { validateLimits } from "./validate-limits.mjs";

const limits = {
  requestBodyBytes: 100_000_000,
  staticAssetFiles: 20_000,
  staticAssetFileBytes: 25 * 1024 * 1024,
};

test("accepts the generated Web build and current Upload policy", () => {
  const result = validateLimits({ uploadBytes: 50 * 1024 * 1024, assetsDirectory: "web/dist", limits });
  assert.equal(result.valid, true);
  assert.equal(result.assetFiles, 43);
});

test("rejects an Upload policy above the inbound Worker limit", () => {
  const result = validateLimits({ uploadBytes: 100_000_001, assetsDirectory: "web/dist", limits });
  assert.equal(result.valid, false);
  assert.equal(result.violations[0].code, "upload_exceeds_worker_request_body");
});
