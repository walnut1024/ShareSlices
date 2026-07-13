import type { ObjectStorage } from "../../storage/index.js";

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

export async function discardUncommittedRawObject(storage: ObjectStorage, key: string): Promise<void> {
  await storage.deleteObject(key).catch(() => undefined);
}
