import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { AwsS3ObjectStorage, InMemoryObjectStorage } from "../src/storage/index.js";

async function* chunks(...values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) {
    yield Buffer.from(value);
  }
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of body) {
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts);
}

describe("InMemoryObjectStorage", () => {
  it("streams a raw ZIP write and returns its size and SHA-256", async () => {
    const storage = new InMemoryObjectStorage();

    const result = await storage.writeRawZip({
      key: "raw/upload-1.zip",
      body: chunks("zip-", "content")
    });

    expect(result).toEqual({
      key: "raw/upload-1.zip",
      sizeBytes: 11,
      sha256: createHash("sha256").update("zip-content").digest("hex")
    });
    expect(await storage.readForTest("raw/upload-1.zip")).toEqual(Buffer.from("zip-content"));
  });

  it("writes and streams a committed object with its metadata", async () => {
    const storage = new InMemoryObjectStorage();
    await storage.writeStagingObject({
      key: "committed/version-1/index.html",
      body: chunks("<h1>", "Hello</h1>"),
      contentType: "text/html; charset=utf-8"
    });

    const object = await storage.readCommittedObject("committed/version-1/index.html");

    expect(object.contentType).toBe("text/html; charset=utf-8");
    expect(object.sizeBytes).toBe(14);
    expect(await collect(object.body)).toEqual(Buffer.from("<h1>Hello</h1>"));
  });

  it("removes only objects under the requested staging prefix with idempotent behavior", async () => {
    const storage = new InMemoryObjectStorage();
    await storage.writeStagingObject({ key: "staging/attempt-1/a.js", body: chunks("a") });
    await storage.writeStagingObject({ key: "staging/attempt-1/b.css", body: chunks("b") });
    await storage.writeStagingObject({ key: "staging/attempt-10/keep.js", body: chunks("keep") });

    const result = await storage.removeStagingPrefix("staging/attempt-1/");

    expect(result).toEqual({ deletedCount: 2 });
    await expect(storage.readCommittedObject("staging/attempt-1/a.js")).rejects.toThrow(
      "Object not found"
    );
    expect(await storage.readForTest("staging/attempt-10/keep.js")).toEqual(Buffer.from("keep"));
  });

  it("lists bounded object pages and safely repeats key deletion", async () => {
    const lastModified = new Date("2026-07-10T00:00:00Z");
    const storage = new InMemoryObjectStorage(() => lastModified);
    await storage.writeRawZip({ key: "raw/a.zip", body: chunks("a") });
    await storage.writeRawZip({ key: "raw/b.zip", body: chunks("b") });
    await storage.writeRawZip({ key: "raw/c.zip", body: chunks("c") });

    await expect(storage.listObjects({ prefix: "raw/", limit: 2 })).resolves.toEqual({
      objects: [
        { key: "raw/a.zip", lastModified },
        { key: "raw/b.zip", lastModified }
      ],
      nextCursor: "raw/b.zip"
    });
    await expect(
      storage.listObjects({ prefix: "raw/", limit: 2, cursor: "raw/b.zip" })
    ).resolves.toEqual({ objects: [{ key: "raw/c.zip", lastModified }] });

    await storage.deleteObject("raw/a.zip");
    await storage.deleteObject("raw/a.zip");
    expect(await storage.readForTest("raw/a.zip")).toBeUndefined();
  });
});

describe("AwsS3ObjectStorage", () => {
  it("rejects an interrupted source stream instead of leaving the S3 body open", async () => {
    async function* interruptedBody(): AsyncIterable<Uint8Array> {
      yield Buffer.from("partial");
      throw new Error("upload interrupted");
    }
    const createMultipartUpload = vi.fn((input: { params: { Body?: unknown } }) => ({
      done: async () => collect(input.params.Body as AsyncIterable<Uint8Array>)
    }));
    const storage = new AwsS3ObjectStorage({
      client: { send: vi.fn() },
      bucket: "artifact-bucket",
      createMultipartUpload: createMultipartUpload as never
    });

    await expect(
      storage.writeRawZip({ key: "raw/interrupted.zip", body: interruptedBody() })
    ).rejects.toThrow("upload interrupted");
  }, 1_000);

  it("maps streaming writes and committed reads to S3 commands", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetObjectCommand) {
        return {
          Body: Readable.from([Buffer.from("committed")]),
          ContentLength: 9,
          ContentType: "text/plain"
        };
      }
      throw new Error("Unexpected command");
    });
    const uploads: Array<{ Bucket?: string; Key?: string; Body?: unknown }> = [];
    const createMultipartUpload = vi.fn((input: { params: { Bucket?: string; Key?: string; Body?: unknown } }) => ({
      done: async () => {
        uploads.push(input.params);
        expect(await collect(input.params.Body as AsyncIterable<Uint8Array>)).not.toHaveLength(0);
      }
    }));
    const storage = new AwsS3ObjectStorage({
      client: { send },
      bucket: "artifact-bucket",
      createMultipartUpload: createMultipartUpload as never
    });

    const raw = await storage.writeRawZip({
      key: "raw/upload-1.zip",
      body: chunks("raw", "-zip")
    });
    await storage.writeStagingObject({
      key: "staging/attempt-1/index.html",
      body: chunks("<h1>ready</h1>"),
      contentType: "text/html"
    });
    const committed = await storage.readCommittedObject("committed/version-1/index.html");

    expect(raw).toEqual({
      key: "raw/upload-1.zip",
      sizeBytes: 7,
      sha256: createHash("sha256").update("raw-zip").digest("hex")
    });
    expect(await collect(committed.body)).toEqual(Buffer.from("committed"));
    expect(committed).toMatchObject({ contentType: "text/plain", sizeBytes: 9 });
    expect(uploads.map(({ Bucket, Key }) => ({ Bucket, Key }))).toEqual([
      { Bucket: "artifact-bucket", Key: "raw/upload-1.zip" },
      { Bucket: "artifact-bucket", Key: "staging/attempt-1/index.html" }
    ]);
    expect(send.mock.calls.map(([command]) => (command as { constructor: unknown }).constructor)).toEqual([
      GetObjectCommand
    ]);
  });

  it("lists every page and deletes staging objects in bounded S3 batches", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        expect(command.input).toMatchObject({
          Bucket: "artifact-bucket",
          Prefix: "staging/attempt-1/"
        });
        return command.input.ContinuationToken
          ? { Contents: [{ Key: "staging/attempt-1/c" }], IsTruncated: false }
          : {
              Contents: [
                { Key: "staging/attempt-1/a" },
                { Key: "staging/attempt-1/b" }
              ],
              IsTruncated: true,
              NextContinuationToken: "page-2"
            };
      }
      if (command instanceof DeleteObjectsCommand) {
        return { Deleted: command.input.Delete?.Objects };
      }
      throw new Error("Unexpected command");
    });
    const storage = new AwsS3ObjectStorage({ client: { send }, bucket: "artifact-bucket" });

    await expect(storage.removeStagingPrefix("staging/attempt-1/")).resolves.toEqual({
      deletedCount: 3
    });

    const deletes = send.mock.calls
      .map(([command]) => command)
      .filter((command): command is DeleteObjectsCommand => command instanceof DeleteObjectsCommand);
    expect(deletes).toHaveLength(2);
    expect(deletes.flatMap((command) => command.input.Delete?.Objects ?? [])).toEqual([
      { Key: "staging/attempt-1/a" },
      { Key: "staging/attempt-1/b" },
      { Key: "staging/attempt-1/c" }
    ]);
  });

  it("maps bounded listing and idempotent deletion to S3 commands", async () => {
    const lastModified = new Date("2026-07-10T00:00:00Z");
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: [{ Key: "raw/artifact/upload.zip", LastModified: lastModified }],
          IsTruncated: true,
          NextContinuationToken: "next-page"
        };
      }
      if (command instanceof DeleteObjectCommand) {
        return {};
      }
      throw new Error("Unexpected command");
    });
    const storage = new AwsS3ObjectStorage({ client: { send }, bucket: "artifact-bucket" });

    await expect(
      storage.listObjects({ prefix: "raw/", limit: 25, cursor: "current-page" })
    ).resolves.toEqual({
      objects: [{ key: "raw/artifact/upload.zip", lastModified }],
      nextCursor: "next-page"
    });
    await storage.deleteObject("raw/artifact/upload.zip");

    expect((send.mock.calls[0]?.[0] as ListObjectsV2Command).input).toEqual({
      Bucket: "artifact-bucket",
      Prefix: "raw/",
      MaxKeys: 25,
      ContinuationToken: "current-page"
    });
    expect((send.mock.calls[1]?.[0] as DeleteObjectCommand).input).toEqual({
      Bucket: "artifact-bucket",
      Key: "raw/artifact/upload.zip"
    });
  });
});
