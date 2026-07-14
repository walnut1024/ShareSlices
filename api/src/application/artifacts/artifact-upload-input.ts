import { createHash } from "node:crypto";
import type { ObjectBody, ObjectStorage } from "../../storage/index.js";

export class RequestedEntryValidationError extends Error {
  constructor() {
    super("Entry must be a safe archive-relative path.");
    this.name = "RequestedEntryValidationError";
  }
}

export function normalizeRequestedEntry(value: string | null): string | null {
  if (value === null) return null;
  const entry = value.trim();
  if (
    !entry ||
    entry.startsWith("/") ||
    entry.includes("\\") ||
    entry.split("/").some((part) => !part || part === "..")
  ) {
    throw new RequestedEntryValidationError();
  }
  return entry;
}

export async function hashUploadBody(
  body: ObjectBody,
  maxBytes: number,
  tooLargeError: () => Error
): Promise<{ sizeBytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of body) {
    sizeBytes += chunk.byteLength;
    if (sizeBytes > maxBytes) throw tooLargeError();
    hash.update(chunk);
  }
  return { sizeBytes, sha256: hash.digest("hex") };
}

export async function discardUncommittedRawObject(storage: ObjectStorage, key: string): Promise<void> {
  await storage.deleteObject(key).catch(() => undefined);
}
