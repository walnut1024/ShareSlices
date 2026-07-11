import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import type { UploadPolicy } from "../api/artifacts";
import { preflightArchive, preflightEntries } from "./archive-preflight";
import { preflightArtifactZip } from "./archive-preflight-client";

const policy: UploadPolicy = {
  revision: "policy-1",
  maxArchiveBytes: 10_000,
  maxExpandedBytes: 1_000,
  maxFileCount: 10,
  maxFileBytes: 500,
  enabledExtensions: [".html", ".css", ".js", ".png"]
};

describe("archive preflight", () => {
  it("ignores macOS metadata and infers the only named root HTML entry", () => {
    expect(preflightEntries([
      { path: "report.html", sizeBytes: 20 },
      { path: "__MACOSX/._report.html", sizeBytes: 10 },
      { path: ".DS_Store", sizeBytes: 10 }
    ], policy)).toMatchObject({
      primaryIssue: null,
      warnings: [
        { code: "ignored_system_metadata", details: { ignoredCount: 2, paths: ["__MACOSX/._report.html", ".DS_Store"] } },
        { code: "entry_file_inferred", details: { entryFile: "report.html" } }
      ]
    });
  });

  it("removes one common wrapper directory before resolving the entry", () => {
    expect(preflightEntries([
      { path: "artifact/index.html", sizeBytes: 20 },
      { path: "artifact/assets/app.js", sizeBytes: 20 }
    ], policy)).toMatchObject({
      primaryIssue: null,
      warnings: [{ code: "wrapper_directory_removed", details: { directory: "artifact" } }]
    });
  });

  it("rejects multiple root HTML candidates", () => {
    expect(preflightEntries([
      { path: "a.html", sizeBytes: 1 },
      { path: "b.HTML", sizeBytes: 1 }
    ], policy).primaryIssue).toMatchObject({
      code: "ambiguous_entry_file",
      details: { candidates: ["a.html", "b.HTML"] }
    });
  });

  it("reports nested candidates when no root HTML exists", () => {
    expect(preflightEntries([
      { path: "assets/report.html", sizeBytes: 1 },
      { path: "favicon.png", sizeBytes: 1 }
    ], policy).primaryIssue).toMatchObject({
      code: "missing_entry_file",
      details: { candidates: ["assets/report.html"] }
    });
  });

  it("includes path and extension for unsupported formats", () => {
    expect(preflightEntries([
      { path: "index.html", sizeBytes: 1 },
      { path: "notes.md", sizeBytes: 1 }
    ], policy).primaryIssue).toMatchObject({
      code: "unsupported_format",
      details: { path: "notes.md", extension: ".md" }
    });
  });

  it.each([
    ["unsafe_archive_path", "../index.html", {}],
    ["unsafe_archive_path", "C:/index.html", {}],
    ["nested_archive", "bundle.zip", { path: "bundle.zip" }]
  ])("reports %s for %s", (code, path, details) => {
    const report = preflightEntries([
      { path: "index.html", sizeBytes: 1 },
      { path, sizeBytes: 1 }
    ], policy);
    expect(report.primaryIssue).toMatchObject({ code, details });
  });

  it("rejects duplicate normalized archive paths", () => {
    expect(preflightEntries([
      { path: "index.html", sizeBytes: 1 },
      { path: "index.html", sizeBytes: 1 }
    ], policy).primaryIssue).toMatchObject({ code: "duplicate_archive_path", details: { path: "index.html" } });
  });

  it.each([
    ["archive", { ...policy, maxArchiveBytes: 10 }, { archiveSizeBytes: 11 }, "archive_too_large", { actualBytes: 11, limitBytes: 10 }],
    ["expanded", { ...policy, maxExpandedBytes: 1 }, {}, "expanded_size_exceeded", { actualBytes: 2, limitBytes: 1 }],
    ["single file", { ...policy, maxFileBytes: 1 }, {}, "single_file_too_large", { actualBytes: 2, limitBytes: 1 }],
    ["file count", { ...policy, maxFileCount: 1 }, {}, "file_count_exceeded", { actualCount: 2, limitCount: 1 }]
  ])("reports %s limits with actual and limit values", (_name, nextPolicy, options, code, details) => {
    expect(preflightEntries([
      { path: "index.html", sizeBytes: code === "single_file_too_large" ? 2 : 1 },
      { path: "app.js", sizeBytes: 1 }
    ], nextPolicy as UploadPolicy, options).primaryIssue).toMatchObject({ code, details });
  });

  it("caps issue candidates and ignored metadata samples at 20", () => {
    const candidates = Array.from({ length: 25 }, (_, index) => ({ path: `nested/${index}.html`, sizeBytes: 1 }));
    const metadata = Array.from({ length: 25 }, (_, index) => ({ path: `__MACOSX/._${index}.html`, sizeBytes: 1 }));
    const report = preflightEntries([...candidates, ...metadata], policy);

    expect(report.primaryIssue?.details.candidates).toHaveLength(20);
    expect(report.warnings[0]?.details.paths).toHaveLength(20);
    expect(report.warnings[0]?.details.ignoredCount).toBe(25);
  });

  it("reads ZIP entries into the same deterministic report", async () => {
    const bytes = zipSync({ "report.html": new Uint8Array([60, 33, 100, 111, 99, 116, 121, 112, 101, 62]) });
    const report = await preflightArchive(bytes, policy);
    expect(report).toMatchObject({
      primaryIssue: null,
      warnings: [{ code: "entry_file_inferred", details: { entryFile: "report.html" } }]
    });
  });

  it("reports invalid ZIP bytes without exposing a parser error", async () => {
    await expect(preflightArchive(new Uint8Array([1, 2, 3, 4]), policy)).resolves.toMatchObject({
      primaryIssue: { code: "invalid_zip", details: {} }
    });
  });

  it("rejects a Unix symlink before authorizing the ZIP", async () => {
    const bytes = zipSync({ "index.html": new TextEncoder().encode("valid"), "linked.js": new TextEncoder().encode("target.js") });
    markCentralEntryAsUnixSymlink(bytes, "linked.js");

    await expect(preflightArchive(bytes, policy)).resolves.toMatchObject({
      primaryIssue: { code: "unsupported_file_type", details: { path: "linked.js" } }
    });
  });

  it("ignores a fake central-directory signature embedded in file content", async () => {
    const payload = new Uint8Array(60);
    payload.set([0x50, 0x4b, 0x01, 0x02], 0);
    payload[5] = 3;
    payload[40] = 0;
    payload[41] = 0x60;
    const bytes = zipSync({ "index.html": new TextEncoder().encode("valid"), "payload.js": payload }, { level: 0 });

    await expect(preflightArchive(bytes, policy)).resolves.toMatchObject({ primaryIssue: null });
  });

  it("stops observing a highly compressed file as soon as the single-file limit is crossed", async () => {
    const bytes = zipSync({ "index.html": new Uint8Array(2_000_000) }, { level: 9 });
    let observedBytes = 0;
    const report = await preflightArchive(bytes, { ...policy, maxArchiveBytes: bytes.length + 1, maxFileBytes: 1_024, maxExpandedBytes: 4_096 }, {
      onObservedBytes: (count) => {
        observedBytes = count;
      }
    });

    expect(report.primaryIssue).toMatchObject({
      code: "single_file_too_large",
      details: { path: "index.html", limitBytes: 1_024 }
    });
    expect(observedBytes).toBe(0);
  });

  it.each([
    ["fatal UTF-8", "index.html", new Uint8Array([0xc3, 0x28]), "text"],
    ["PNG prefix", "image.png", new TextEncoder().encode("not png"), "png"],
    ["complete JSON", "data.json", new TextEncoder().encode("{broken"), "json"],
    ["clear SVG root", "icon.svg", new TextEncoder().encode("<html/>"), "svg"]
  ])("reports invalid_file_content for %s validation", async (_name, path, content, validationKind) => {
    const bytes = zipSync({ "index.html": new TextEncoder().encode("valid"), [path]: content });
    const report = await preflightArchive(bytes, {
      ...policy,
      enabledExtensions: [...policy.enabledExtensions, ".json", ".svg"]
    });
    expect(report.primaryIssue).toMatchObject({
      code: "invalid_file_content",
      details: { path, validationKind }
    });
  });

  it.each([
    [".html", "text"], [".css", "text"], [".js", "text"], [".mjs", "text"], [".txt", "text"], [".csv", "text"], [".tsv", "text"],
    [".json", "json"], [".svg", "svg"], [".png", "png"], [".jpg", "jpeg"], [".jpeg", "jpeg"], [".gif", "gif"],
    [".webp", "webp"], [".avif", "avif"], [".ico", "ico"], [".woff", "woff"], [".woff2", "woff2"]
  ])("keeps %s aligned with the %s content validator", async (extension, validationKind) => {
    const path = `invalid${extension}`;
    const invalidContent = validationKind === "text" ? new Uint8Array([0xc3, 0x28]) : new TextEncoder().encode("invalid");
    const bytes = zipSync({ "index.html": new TextEncoder().encode("valid"), [path]: invalidContent });
    const report = await preflightArchive(bytes, { ...policy, enabledExtensions: [".html", extension] });
    expect(report.primaryIssue).toMatchObject({ code: "invalid_file_content", details: { path, validationKind } });
  });

  it.each([
    ["rejects a 12-byte AVIF header", avifBytes("avif", new Uint8Array(), 12), true],
    ["does not treat the minor version as a compatible AVIF brand", avifBytes("heic", new TextEncoder().encode("avif"), 16), true],
    ["accepts an AVIF compatible brand from offset 16", avifBytes("heic", new Uint8Array([0, 0, 0, 0, 0x61, 0x76, 0x69, 0x66]), 20), false]
  ])("%s", async (_name, content, invalid) => {
    const report = await preflightArchive(
      zipSync({ "index.html": new TextEncoder().encode("valid"), "image.avif": content }),
      { ...policy, enabledExtensions: [".html", ".avif"] }
    );
    expect(report.primaryIssue?.code === "invalid_file_content").toBe(invalid);
  });

  it("accepts a self-closing SVG root", async () => {
    const report = await preflightArchive(
      zipSync({ "index.html": new TextEncoder().encode("valid"), "icon.svg": new TextEncoder().encode("<?xml version=\"1.0\"?><!-- ok --><svg xmlns=\"http://www.w3.org/2000/svg\"/>") }),
      { ...policy, enabledExtensions: [".html", ".svg"] }
    );
    expect(report.primaryIssue).toBeNull();
  });

  it.each(["<!DOCTYPE svg><svg/>", "<![CDATA[x]]><svg/>"])("matches Rust by accepting root-level SVG markup: %s", async (svg) => {
    const report = await preflightArchive(
      zipSync({ "index.html": new TextEncoder().encode("valid"), "icon.svg": new TextEncoder().encode(svg) }),
      { ...policy, enabledExtensions: [".html", ".svg"] }
    );
    expect(report.primaryIssue).toBeNull();
  });

  it.each(["<html></html>", "text<svg></svg>"])("rejects an SVG with no clear svg root: %s", async (svg) => {
    const report = await preflightArchive(
      zipSync({ "index.html": new TextEncoder().encode("valid"), "icon.svg": new TextEncoder().encode(svg) }),
      { ...policy, enabledExtensions: [".html", ".svg"] }
    );
    expect(report.primaryIssue).toMatchObject({ code: "invalid_file_content", details: { path: "icon.svg", validationKind: "svg" } });
  });

  it.each(["<x:svg/>", "<svg>&bogus;</svg>", "<svg><g></svg>", "<svg></svg><svg></svg>"])("keeps server-authoritative SVG parsing for content after a valid root: %s", async (svg) => {
    const report = await preflightArchive(
      zipSync({ "index.html": new TextEncoder().encode("valid"), "icon.svg": new TextEncoder().encode(svg) }),
      { ...policy, enabledExtensions: [".html", ".svg"] }
    );
    expect(report.primaryIssue).toBeNull();
  });

  it("reports invalid wrapped content with its effective path", async () => {
    const report = await preflightArchive(
      zipSync({ "artifact/index.html": new TextEncoder().encode("valid"), "artifact/image.png": new TextEncoder().encode("invalid") }),
      policy
    );
    expect(report.primaryIssue).toMatchObject({ code: "invalid_file_content", details: { path: "image.png", validationKind: "png" } });
  });

  it("reports an observed wrapped size limit with its effective path", async () => {
    const bytes = zipSync({ "artifact/index.html": new TextEncoder().encode("valid"), "artifact/image.png": new Uint8Array(20) }, { level: 0 });
    clearLocalOriginalSize(bytes, 1);
    const report = await preflightArchive(bytes, { ...policy, maxFileBytes: 10 });
    expect(report.primaryIssue).toMatchObject({ code: "single_file_too_large", details: { path: "image.png", limitBytes: 10 } });
  });
});

describe("archive preflight worker client", () => {
  it("transfers the ZIP buffer and terminates the Worker after a result", async () => {
    const report = { primaryIssue: null, issues: [], warnings: [] };
    let instance!: FakeWorker;
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage = vi.fn((message: { id: string }, transfer: Transferable[]) => {
        expect(transfer).toHaveLength(1);
        queueMicrotask(() => this.onmessage?.({ data: { id: message.id, report } } as MessageEvent));
      });
      terminate = vi.fn();
      constructor() {
        instance = this;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);

    await expect(preflightArtifactZip(new File(["zip"], "report.zip"), policy)).resolves.toEqual(report);
    expect(instance.terminate).toHaveBeenCalledOnce();
  });

  it("terminates the Worker when preflight is cancelled", async () => {
    let instance!: FakeWorker;
    class FakeWorker {
      onmessage = null;
      onerror = null;
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() {
        instance = this;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    const result = preflightArtifactZip(new File(["zip"], "report.zip"), policy, controller.signal);
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(instance.terminate).toHaveBeenCalledOnce();
  });
});

function avifBytes(majorBrand: string, tail: Uint8Array, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  bytes.set(new TextEncoder().encode(majorBrand), 8);
  bytes.set(tail.subarray(0, Math.max(0, length - 12)), 12);
  return bytes;
}

function clearLocalOriginalSize(bytes: Uint8Array, entryIndex: number): void {
  let found = -1;
  for (let index = 0; index <= bytes.length - 4; index += 1) {
    if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x03 && bytes[index + 3] === 0x04) {
      found += 1;
      if (found === entryIndex) {
        bytes.fill(0, index + 22, index + 26);
        return;
      }
    }
  }
  throw new Error("ZIP local header not found.");
}

function markCentralEntryAsUnixSymlink(bytes: Uint8Array, expectedName: string): void {
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (bytes[offset] !== 0x50 || bytes[offset + 1] !== 0x4b || bytes[offset + 2] !== 0x01 || bytes[offset + 3] !== 0x02) continue;
    const nameLength = bytes[offset + 28]! | (bytes[offset + 29]! << 8);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name !== expectedName) continue;
    bytes[offset + 5] = 3;
    bytes[offset + 40] = 0;
    bytes[offset + 41] = 0xa0;
    return;
  }
  throw new Error("ZIP central entry not found.");
}
