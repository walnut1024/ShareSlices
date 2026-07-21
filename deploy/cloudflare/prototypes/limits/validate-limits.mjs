import { readdirSync, statSync } from "node:fs";
import path from "node:path";

export function validateLimits({ uploadBytes, assetsDirectory, limits }) {
  const files = [];
  for (const entry of readdirSync(assetsDirectory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolutePath = path.join(entry.parentPath, entry.name);
    files.push({ path: path.relative(assetsDirectory, absolutePath), bytes: statSync(absolutePath).size });
  }
  const violations = [];
  if (uploadBytes > limits.requestBodyBytes) {
    violations.push({ code: "upload_exceeds_worker_request_body", actual: uploadBytes, limit: limits.requestBodyBytes });
  }
  if (files.length > limits.staticAssetFiles) {
    violations.push({ code: "static_asset_count_exceeded", actual: files.length, limit: limits.staticAssetFiles });
  }
  for (const file of files.filter((candidate) => candidate.bytes > limits.staticAssetFileBytes)) {
    violations.push({ code: "static_asset_file_exceeded", path: file.path, actual: file.bytes, limit: limits.staticAssetFileBytes });
  }
  return { valid: violations.length === 0, uploadBytes, assetFiles: files.length, largestAssetBytes: Math.max(0, ...files.map((file) => file.bytes)), violations };
}
