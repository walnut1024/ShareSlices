import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import type { UploadPolicy } from "../api/artifacts";

const REPORT_LIMIT = 20;
const CHUNK_SIZE = 16 * 1024;
const NESTED_ARCHIVE_EXTENSIONS = [".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar"];

export type ValidationDetails = {
  path?: string;
  paths?: string[];
  candidates?: string[];
  extension?: string;
  validationKind?: string;
  actualBytes?: number | string;
  limitBytes?: number | string;
  actualCount?: number | string;
  limitCount?: number | string;
  ignoredCount?: number | string;
  directory?: string;
  entryFile?: string;
};

export type ValidationNotice = {
  code: string;
  message: string;
  action: string | null;
  details: ValidationDetails;
};

export type ValidationReport = {
  primaryIssue: ValidationNotice | null;
  issues: ValidationNotice[];
  warnings: ValidationNotice[];
};

export type ArchiveEntry = { path: string; sizeBytes: number; directory?: boolean };
export type PreflightInstrumentation = { onObservedBytes?: (count: number) => void };

type ValidationKind = "text" | "json" | "svg" | "png" | "jpeg" | "gif" | "webp" | "avif" | "ico" | "woff" | "woff2";
const VALIDATION_KINDS: Record<string, ValidationKind> = {
  ".html": "text", ".css": "text", ".js": "text", ".mjs": "text", ".txt": "text", ".csv": "text", ".tsv": "text",
  ".json": "json", ".svg": "svg", ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".gif": "gif", ".webp": "webp",
  ".avif": "avif", ".ico": "ico", ".woff": "woff", ".woff2": "woff2"
};

const copy: Record<string, [string, string | null]> = {
  archive_too_large: ["The ZIP exceeds the allowed size.", "Reduce the ZIP size, then upload it again."],
  invalid_zip: ["The uploaded file is not a valid ZIP.", "Create a new ZIP and upload it again."],
  unsafe_archive_path: ["The ZIP contains an unsafe file path.", "Remove unsafe paths and create a new ZIP."],
  duplicate_archive_path: ["The ZIP contains duplicate file paths.", "Rename or remove duplicate files and create a new ZIP."],
  unsupported_file_type: ["The ZIP contains a link or special file.", "Remove links and special files, then create a new ZIP."],
  nested_archive: ["The ZIP contains another archive.", "Expand nested archives before creating the ZIP."],
  unsupported_format: ["A file format is not supported.", "Remove or convert the file, then upload a new ZIP."],
  invalid_file_content: ["A file does not match its expected format.", "Replace the file with valid content, then upload a new ZIP."],
  expanded_size_exceeded: ["The expanded files exceed the allowed size.", "Reduce the expanded content, then upload a new ZIP."],
  file_count_exceeded: ["The ZIP contains too many files.", "Reduce the number of files, then upload a new ZIP."],
  single_file_too_large: ["A file exceeds the allowed size.", "Reduce or split the file, then upload a new ZIP."],
  missing_entry_file: ["The ZIP has no root HTML entry file.", "Add one HTML file at the ZIP root."],
  ambiguous_entry_file: ["The ZIP has multiple possible root HTML entry files.", "Keep one root HTML file or name the intended file index.html."],
  ignored_system_metadata: ["System metadata files were ignored.", null],
  wrapper_directory_removed: ["A common wrapper directory was removed.", null],
  entry_file_inferred: ["The only root HTML file was selected as the entry file.", null]
};

function notice(code: string, details: ValidationDetails = {}): ValidationNotice {
  const [message, action] = copy[code] ?? ["Archive validation failed.", "Correct the ZIP and upload it again."];
  const boundedDetails = { ...details };
  if (details.paths) boundedDetails.paths = details.paths.slice(0, REPORT_LIMIT);
  if (details.candidates) boundedDetails.candidates = details.candidates.slice(0, REPORT_LIMIT);
  return {
    code,
    message,
    action,
    details: boundedDetails
  };
}

function failure(code: string, details: ValidationDetails, warnings: ValidationNotice[]): ValidationReport {
  return { primaryIssue: notice(code, details), issues: [], warnings };
}

function safePath(path: string): string | null {
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\\") || path.includes("\0")) return null;
  const parts = path.split("/");
  const normalized = path.endsWith("/") ? parts.slice(0, -1) : parts;
  if (normalized.length === 0 || normalized.some((part) => !part || part === "." || part === "..")) return null;
  return normalized.join("/");
}

function isIgnoredMetadata(path: string): boolean {
  const basename = path.split("/").at(-1) ?? "";
  return path.startsWith("__MACOSX/") || basename.startsWith("._") || basename === ".DS_Store";
}

function extension(path: string): string | null {
  const basename = path.split("/").at(-1) ?? "";
  const dot = basename.lastIndexOf(".");
  return dot > 0 ? basename.slice(dot) : null;
}

export function preflightEntries(
  input: ArchiveEntry[],
  policy: UploadPolicy,
  { archiveSizeBytes }: { archiveSizeBytes?: number } = {}
): ValidationReport {
  const warnings: ValidationNotice[] = [];
  if (archiveSizeBytes !== undefined && archiveSizeBytes > policy.maxArchiveBytes) {
    return failure("archive_too_large", { actualBytes: archiveSizeBytes, limitBytes: policy.maxArchiveBytes }, warnings);
  }

  const paths = new Set<string>();
  const entries: ArchiveEntry[] = [];
  const ignoredPaths: string[] = [];
  let ignoredCount = 0;
  for (const raw of input) {
    const path = safePath(raw.path);
    if (!path) return failure("unsafe_archive_path", {}, warnings);
    if (paths.has(path)) return failure("duplicate_archive_path", { path }, warnings);
    paths.add(path);
    if (raw.directory) continue;
    if (isIgnoredMetadata(path)) {
      ignoredCount += 1;
      if (ignoredPaths.length < REPORT_LIMIT) ignoredPaths.push(path);
    } else {
      entries.push({ ...raw, path });
    }
  }
  if (ignoredCount > 0) warnings.push(notice("ignored_system_metadata", { ignoredCount, paths: ignoredPaths }));

  const firstDirectory = entries[0]?.path.split("/")[0];
  if (firstDirectory && entries.every((entry) => entry.path.startsWith(`${firstDirectory}/`))) {
    const stripped = new Set<string>();
    for (const entry of entries) {
      const path = entry.path.slice(firstDirectory.length + 1);
      if (!path || stripped.has(path)) return failure("duplicate_archive_path", {}, warnings);
      stripped.add(path);
      entry.path = path;
    }
    warnings.push(notice("wrapper_directory_removed", { directory: firstDirectory }));
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));

  if (!entries.some((entry) => entry.path === "index.html")) {
    const roots = entries.filter((entry) => !entry.path.includes("/") && extension(entry.path)?.toLowerCase() === ".html").map((entry) => entry.path);
    if (roots.length === 1) warnings.push(notice("entry_file_inferred", { entryFile: roots[0]! }));
    else if (roots.length > 1) return failure("ambiguous_entry_file", { candidates: roots }, warnings);
    else {
      const candidates = entries.filter((entry) => extension(entry.path)?.toLowerCase() === ".html").map((entry) => entry.path);
      return failure("missing_entry_file", { candidates }, warnings);
    }
  }

  let expanded = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const ext = extension(entry.path);
    if (ext && NESTED_ARCHIVE_EXTENSIONS.includes(ext.toLowerCase())) return failure("nested_archive", { path: entry.path }, warnings);
    if (!ext || !policy.enabledExtensions.includes(ext)) {
      return failure("unsupported_format", ext ? { path: entry.path, extension: ext } : { path: entry.path }, warnings);
    }
    if (entry.sizeBytes > policy.maxFileBytes) return failure("single_file_too_large", { path: entry.path, actualBytes: entry.sizeBytes, limitBytes: policy.maxFileBytes }, warnings);
    if (index + 1 > policy.maxFileCount) return failure("file_count_exceeded", { path: entry.path, actualCount: index + 1, limitCount: policy.maxFileCount }, warnings);
    expanded += entry.sizeBytes;
    if (expanded > policy.maxExpandedBytes) return failure("expanded_size_exceeded", { path: entry.path, actualBytes: expanded, limitBytes: policy.maxExpandedBytes }, warnings);
  }
  return { primaryIssue: null, issues: [], warnings };
}

export function preflightArchive(
  bytes: Uint8Array,
  policy: UploadPolicy,
  instrumentation: PreflightInstrumentation = {}
): Promise<ValidationReport> {
  if (bytes.byteLength > policy.maxArchiveBytes) {
    return Promise.resolve(preflightEntries([], policy, { archiveSizeBytes: bytes.byteLength }));
  }
  const signature = bytes.length >= 4 ? `${bytes[0]},${bytes[1]},${bytes[2]},${bytes[3]}` : "";
  if (signature !== "80,75,3,4" && signature !== "80,75,5,6") {
    return Promise.resolve(failure("invalid_zip", {}, []));
  }
  const scanned = scanZipEntries(bytes);
  if ("report" in scanned) return Promise.resolve(scanned.report);
  const structureReport = preflightEntries(scanned.entries, policy, { archiveSizeBytes: bytes.byteLength });
  if (structureReport.primaryIssue) return Promise.resolve(structureReport);
  const paths = effectivePathMap(scanned.entries);
  return Promise.resolve(validateZipContents(bytes, policy, paths, structureReport.warnings, instrumentation));
}

function scanZipEntries(bytes: Uint8Array): { entries: ArchiveEntry[] } | { report: ValidationReport } {
  const unsupported = unsupportedUnixEntry(bytes);
  if (unsupported) return { report: failure("unsupported_file_type", { path: unsupported }, []) };
  const entries: ArchiveEntry[] = [];
  const streams: UnzipFile[] = [];
  let terminal: ValidationReport | null = null;
  const seen = new Set<string>();
  const unzip = new Unzip((file) => {
    streams.push(file);
    const path = safePath(file.name);
    if (!path) terminal = failure("unsafe_archive_path", {}, []);
    else if (seen.has(path)) terminal = failure("duplicate_archive_path", { path }, []);
    else {
      seen.add(path);
      entries.push({ path, sizeBytes: file.originalSize ?? 0, directory: file.name.endsWith("/") });
    }
  });
  try {
    for (let offset = 0; offset < bytes.length && !terminal; offset += CHUNK_SIZE) {
      unzip.push(bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length)), offset + CHUNK_SIZE >= bytes.length);
    }
  } catch {
    terminal = failure("invalid_zip", {}, []);
  } finally {
    for (const stream of streams) stream.terminate();
  }
  return terminal ? { report: terminal } : { entries };
}

function unsupportedUnixEntry(bytes: Uint8Array): string | null {
  const directoryEnd = findEndOfCentralDirectory(bytes);
  if (directoryEnd === null) throw new Error("ZIP central directory is unavailable.");
  const entryCount = readU16(bytes, directoryEnd + 10);
  const centralSize = readU32(bytes, directoryEnd + 12);
  const centralOffset = readU32(bytes, directoryEnd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 preflight is unavailable.");
  }
  const centralEnd = centralOffset + centralSize;
  if (centralEnd > directoryEnd || centralEnd > bytes.length)
    throw new Error("ZIP central directory is invalid.");
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralEnd || readU32(bytes, offset) !== 0x02014b50) {
      throw new Error("ZIP central directory is invalid.");
    }
    const nameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > centralEnd) throw new Error("ZIP central directory is invalid.");
    const creator = bytes[offset + 5];
    const mode = readU32(bytes, offset + 38) >>> 16;
    const fileType = mode & 0xf000;
    if (creator === 3 && fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000) {
      return new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    }
    offset = end;
  }
  if (offset !== centralEnd) throw new Error("ZIP central directory is invalid.");
  return null;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number | null {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (readU32(bytes, offset) !== 0x06054b50) continue;
    const commentLength = readU16(bytes, offset + 20);
    if (offset + 22 + commentLength !== bytes.length) continue;
    if (readU16(bytes, offset + 4) !== 0 || readU16(bytes, offset + 6) !== 0) return null;
    if (readU16(bytes, offset + 8) !== readU16(bytes, offset + 10)) return null;
    return offset;
  }
  return null;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (readU16(bytes, offset) | (readU16(bytes, offset + 2) << 16)) >>> 0;
}

function effectivePathMap(entries: ArchiveEntry[]): Map<string, string> {
  const effective = entries.filter((entry) => !entry.directory && !isIgnoredMetadata(entry.path));
  const wrapper = effective[0]?.path.split("/")[0];
  const strip = Boolean(wrapper && effective.every((entry) => entry.path.startsWith(`${wrapper}/`)));
  return new Map(effective.map((entry) => [entry.path, strip ? entry.path.slice(wrapper!.length + 1) : entry.path]));
}

function validateZipContents(
  bytes: Uint8Array,
  policy: UploadPolicy,
  effectivePaths: Map<string, string>,
  warnings: ValidationNotice[],
  instrumentation: PreflightInstrumentation
): ValidationReport {
  const streams: UnzipFile[] = [];
  let terminal: ValidationReport | null = null;
  let expandedBytes = 0;
  let observedBytes = 0;
  const unzip = new Unzip((file) => {
    streams.push(file);
    const sourcePath = safePath(file.name);
    const effectivePath = sourcePath ? effectivePaths.get(sourcePath) : undefined;
    if (!effectivePath) {
      file.ondata = () => {};
      file.terminate();
      return;
    }
    let sizeBytes = 0;
    const kind = validationKind(effectivePath);
    const validator = kind ? createContentValidator(kind) : null;
    file.ondata = (error, chunk, final) => {
      if (terminal) return;
      if (error) {
        terminal = failure("invalid_zip", {}, warnings);
        return;
      }
      const consumed = Math.min(chunk.length, Math.max(0, policy.maxFileBytes - sizeBytes) + 1, Math.max(0, policy.maxExpandedBytes - expandedBytes) + 1);
      observedBytes += consumed;
      instrumentation.onObservedBytes?.(observedBytes);
      sizeBytes += chunk.length;
      expandedBytes += chunk.length;
      if (sizeBytes > policy.maxFileBytes) terminal = failure("single_file_too_large", { path: effectivePath, actualBytes: sizeBytes, limitBytes: policy.maxFileBytes }, warnings);
      else if (expandedBytes > policy.maxExpandedBytes) terminal = failure("expanded_size_exceeded", { path: effectivePath, actualBytes: expandedBytes, limitBytes: policy.maxExpandedBytes }, warnings);
      else if (validator && !validator.push(chunk, final)) terminal = failure("invalid_file_content", { path: effectivePath, validationKind: kind! }, warnings);
      if (terminal) for (const stream of streams) stream.terminate();
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let offset = 0; offset < bytes.length && !terminal; offset += CHUNK_SIZE) {
      unzip.push(bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length)), offset + CHUNK_SIZE >= bytes.length);
    }
  } catch {
    terminal ??= failure("invalid_zip", {}, warnings);
  } finally {
    for (const stream of streams) stream.terminate();
  }
  return terminal ?? { primaryIssue: null, issues: [], warnings };
}

function validationKind(path: string): ValidationKind | null {
  const ext = extension(path);
  return ext ? VALIDATION_KINDS[ext] ?? null : null;
}

type ContentValidator = { push: (chunk: Uint8Array, final: boolean) => boolean };

function createContentValidator(kind: ValidationKind): ContentValidator {
  if (kind === "text") {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return {
      push(chunk, final) {
        try {
          decoder.decode(chunk, { stream: !final });
          return true;
        } catch {
          return false;
        }
      }
    };
  }
  if (kind !== "json" && kind !== "svg") {
    let prefix: Uint8Array<ArrayBufferLike> = new Uint8Array();
    return {
      push(chunk, final) {
        if (prefix.length < 64) {
          const remaining = 64 - prefix.length;
          prefix = joinChunks([prefix, chunk.subarray(0, remaining)]);
        }
        return !final || validPrefix(kind, prefix);
      }
    };
  }
  const chunks: Uint8Array[] = [];
  return {
    push(chunk, final) {
      chunks.push(chunk);
      if (!final) return true;
      const content = joinChunks(chunks);
      return kind === "json" ? validJson(content) : validSvg(content);
    }
  };
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

function decodeUtf8(content: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return null;
  }
}

function validJson(content: Uint8Array): boolean {
  const text = decodeUtf8(content);
  if (text === null) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function validSvg(content: Uint8Array): boolean {
  const text = decodeUtf8(content);
  if (text === null) return false;
  let offset = 0;
  while (offset < text.length) {
    const opening = text.indexOf("<", offset);
    if (opening < 0) return false;
    if (text.slice(offset, opening).trim() !== "") return false;
    if (text.startsWith("<!--", opening)) {
      offset = afterMarker(text, opening + 4, "-->");
    } else if (text.startsWith("<?", opening)) {
      offset = afterMarker(text, opening + 2, "?>");
    } else if (text.startsWith("<![CDATA[", opening)) {
      offset = afterMarker(text, opening + 9, "]]>");
    } else if (text.slice(opening, opening + 9).toUpperCase() === "<!DOCTYPE") {
      offset = afterDoctype(text, opening + 9);
    } else {
      if (text.startsWith("</", opening) || text.startsWith("<!", opening)) return false;
      let nameEnd = opening + 1;
      while (nameEnd < text.length && !/[\s/>]/.test(text[nameEnd]!)) nameEnd += 1;
      const name = text.slice(opening + 1, nameEnd);
      return name.length > 0 && name.split(":").at(-1) === "svg" && findTagEnd(text, nameEnd) >= 0;
    }
    if (offset < 0) return false;
  }
  return false;
}

function afterMarker(text: string, offset: number, marker: string): number {
  const end = text.indexOf(marker, offset);
  return end < 0 ? -1 : end + marker.length;
}

function afterDoctype(text: string, offset: number): number {
  let bracketDepth = 0;
  let quote: string | null = null;
  for (let index = offset; index < text.length; index += 1) {
    const character = text[index]!;
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === ">" && bracketDepth === 0) return index + 1;
  }
  return -1;
}

function findTagEnd(text: string, offset: number): number {
  let quote: string | null = null;
  for (let index = offset; index < text.length; index += 1) {
    const character = text[index]!;
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
}

function validPrefix(kind: Exclude<ValidationKind, "text" | "json" | "svg">, bytes: Uint8Array): boolean {
  const starts = (...prefix: number[]) => prefix.every((value, index) => bytes[index] === value);
  switch (kind) {
    case "png": return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "jpeg": return starts(0xff, 0xd8, 0xff);
    case "gif": return new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF87a" || new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF89a";
    case "webp": return new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP";
    case "avif": {
      if (bytes.length < 16 || new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp") return false;
      if (["avif", "avis"].includes(new TextDecoder().decode(bytes.subarray(8, 12)))) return true;
      for (let offset = 16; offset + 4 <= bytes.length; offset += 4) {
        if (["avif", "avis"].includes(new TextDecoder().decode(bytes.subarray(offset, offset + 4)))) return true;
      }
      return false;
    }
    case "ico": return starts(0, 0, 1, 0);
    case "woff": return new TextDecoder().decode(bytes.subarray(0, 4)) === "wOFF";
    case "woff2": return new TextDecoder().decode(bytes.subarray(0, 4)) === "wOF2";
  }
}
