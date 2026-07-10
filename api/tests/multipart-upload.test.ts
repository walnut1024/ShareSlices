import { describe, expect, it } from "vitest";
import {
  MultipartUploadError,
  parseArtifactMultipartUpload
} from "../src/http/multipart-upload.js";

const encoder = new TextEncoder();

type Part =
  | { name: string; value: string }
  | { name: string; filename: string; contentType: string; body: Uint8Array };

function multipartBytes(boundary: string, parts: Part[], close = true): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    chunks.push(encoder.encode(`--${boundary}\r\n`));
    if ("filename" in part) {
      chunks.push(
        encoder.encode(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.contentType}\r\n\r\n`
        ),
        part.body,
        encoder.encode("\r\n")
      );
    } else {
      chunks.push(
        encoder.encode(
          `Content-Disposition: form-data; name="${part.name}"\r\n` +
            "Content-Type: text/plain; charset=utf-8\r\n\r\n" +
            `${part.value}\r\n`
        )
      );
    }
  }
  if (close) {
    chunks.push(encoder.encode(`--${boundary}--\r\n`));
  }
  return concat(chunks);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function requestFromChunks(
  chunks: Uint8Array[],
  contentType = "multipart/form-data; boundary=upload-boundary"
): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    }
  });
  return new Request("http://api.test/api/artifacts", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return concat(chunks);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "MultipartUploadError",
    code
  });
}

describe("parseArtifactMultipartUpload", () => {
  it("exposes ZIP chunks before the complete request arrives", async () => {
    const boundary = "upload-boundary";
    const prefix = encoder.encode(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="name"\r\n' +
        "Content-Type: text/plain; charset=utf-8\r\n\r\n" +
        "  Streamed artifact  \r\n" +
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="artifact.zip"\r\n' +
        "Content-Type: application/zip\r\n\r\n" +
        "first-"
    );
    let continueRequest: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(prefix);
        continueRequest = () => {
          controller.enqueue(encoder.encode("second"));
          controller.enqueue(encoder.encode(`\r\n--${boundary}--\r\n`));
          controller.close();
        };
      }
    });
    const request = new Request("http://api.test/api/artifacts", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
      duplex: "half"
    } as RequestInit & { duplex: "half" });

    const upload = parseArtifactMultipartUpload(request, { maxArchiveBytes: 20 });
    const iterator = upload.file[Symbol.asyncIterator]();

    await expect(upload.name).resolves.toBe("  Streamed artifact  ");
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: encoder.encode("first-")
    });
    continueRequest?.();
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: encoder.encode("second")
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await expect(upload.completed).resolves.toBeUndefined();
  });

  it("accepts file before name without buffering the complete ZIP", async () => {
    const boundary = "upload-boundary";
    const bytes = multipartBytes(boundary, [
      {
        name: "file",
        filename: "artifact.zip",
        contentType: "application/zip",
        body: encoder.encode("zip")
      },
      { name: "name", value: "After file" }
    ]);
    const upload = parseArtifactMultipartUpload(requestFromChunks([bytes]), {
      maxArchiveBytes: 10
    });

    await expect(collect(upload.file)).resolves.toEqual(encoder.encode("zip"));
    await expect(upload.name).resolves.toBe("After file");
    await expect(upload.completed).resolves.toBeUndefined();
  });

  it("accepts a file-only replacement upload", async () => {
    const bytes = multipartBytes("upload-boundary", [
      {
        name: "file",
        filename: "replacement.zip",
        contentType: "application/zip",
        body: encoder.encode("replacement")
      }
    ]);
    const upload = parseArtifactMultipartUpload(requestFromChunks([bytes]), {
      maxArchiveBytes: 20,
      requireName: false
    });

    await expect(collect(upload.file)).resolves.toEqual(encoder.encode("replacement"));
    await expect(upload.name).resolves.toBe("");
    await expect(upload.completed).resolves.toBeUndefined();
  });

  it.each([
    ["text/plain", "invalid_content_type"],
    ["multipart/form-data", "invalid_boundary"],
    ["multipart/form-data; boundary=bad boundary", "invalid_boundary"]
  ])("rejects invalid request media type %s", (contentType, code) => {
    expect(() =>
      parseArtifactMultipartUpload(requestFromChunks([], contentType), {
        maxArchiveBytes: 10
      })
    ).toThrowError(expect.objectContaining({ code }));
  });

  it.each([
    {
      label: "missing name",
      parts: [
        {
          name: "file",
          filename: "artifact.zip",
          contentType: "application/zip",
          body: encoder.encode("zip")
        }
      ] satisfies Part[],
      code: "missing_name"
    },
    {
      label: "missing file",
      parts: [{ name: "name", value: "Artifact" }] satisfies Part[],
      code: "missing_file"
    },
    {
      label: "duplicate name",
      parts: [
        { name: "name", value: "One" },
        { name: "name", value: "Two" }
      ] satisfies Part[],
      code: "duplicate_name"
    },
    {
      label: "duplicate file",
      parts: [
        {
          name: "file",
          filename: "one.zip",
          contentType: "application/zip",
          body: encoder.encode("one")
        },
        {
          name: "file",
          filename: "two.zip",
          contentType: "application/zip",
          body: encoder.encode("two")
        }
      ] satisfies Part[],
      code: "duplicate_file"
    },
    {
      label: "unknown field",
      parts: [{ name: "description", value: "No" }] satisfies Part[],
      code: "unknown_part"
    },
    {
      label: "unknown file",
      parts: [
        {
          name: "archive",
          filename: "artifact.zip",
          contentType: "application/zip",
          body: encoder.encode("zip")
        }
      ] satisfies Part[],
      code: "unknown_part"
    }
  ])("rejects $label", async ({ parts, code }) => {
    const upload = parseArtifactMultipartUpload(
      requestFromChunks([multipartBytes("upload-boundary", parts)]),
      { maxArchiveBytes: 20 }
    );
    const fileConsumption = collect(upload.file);
    void fileConsumption.catch(() => undefined);

    await expectCode(upload.completed, code);
  });

  it.each([
    ["application/octet-stream", "artifact.zip"],
    ["application/zip", "artifact.txt"]
  ])("rejects a non-ZIP file declaration (%s, %s)", async (contentType, filename) => {
    const upload = parseArtifactMultipartUpload(
      requestFromChunks([
        multipartBytes("upload-boundary", [
          { name: "name", value: "Artifact" },
          { name: "file", filename, contentType, body: encoder.encode("zip") }
        ])
      ]),
      { maxArchiveBytes: 20 }
    );

    await expectCode(upload.completed, "invalid_file_type");
  });

  it("rejects a name field that exceeds its bounded UTF-8 size", async () => {
    const upload = parseArtifactMultipartUpload(
      requestFromChunks([
        multipartBytes("upload-boundary", [
          { name: "name", value: "a".repeat(513) },
          {
            name: "file",
            filename: "artifact.zip",
            contentType: "application/zip",
            body: encoder.encode("zip")
          }
        ])
      ]),
      { maxArchiveBytes: 20 }
    );

    await expectCode(upload.completed, "name_too_large");
  });

  it("stops the file stream when the caller-provided archive limit is exceeded", async () => {
    const upload = parseArtifactMultipartUpload(
      requestFromChunks([
        multipartBytes("upload-boundary", [
          { name: "name", value: "Artifact" },
          {
            name: "file",
            filename: "artifact.zip",
            contentType: "application/zip",
            body: encoder.encode("123456")
          }
        ])
      ]),
      { maxArchiveBytes: 5 }
    );

    await expectCode(collect(upload.file), "archive_too_large");
    await expectCode(upload.completed, "archive_too_large");
  });

  it("rejects an interrupted request stream", async () => {
    const boundary = "upload-boundary";
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `--${boundary}\r\n` +
              'Content-Disposition: form-data; name="file"; filename="artifact.zip"\r\n' +
              "Content-Type: application/zip\r\n\r\npartial"
          )
        );
        controller.error(new Error("socket closed"));
      }
    });
    const request = new Request("http://api.test/api/artifacts", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
      duplex: "half"
    } as RequestInit & { duplex: "half" });
    const upload = parseArtifactMultipartUpload(request, { maxArchiveBytes: 20 });

    await expectCode(collect(upload.file), "stream_interrupted");
    await expectCode(upload.completed, "stream_interrupted");
  });

  it("settles completion when the file consumer stops early", async () => {
    const bytes = multipartBytes("upload-boundary", [
      { name: "name", value: "Artifact" },
      {
        name: "file",
        filename: "artifact.zip",
        contentType: "application/zip",
        body: encoder.encode("content")
      }
    ]);
    const upload = parseArtifactMultipartUpload(requestFromChunks([bytes]), {
      maxArchiveBytes: 20
    });

    for await (const _chunk of upload.file) {
      break;
    }

    await expectCode(upload.completed, "consumer_aborted");
  });

  it("rejects excess parts", async () => {
    const excessParts = parseArtifactMultipartUpload(
      requestFromChunks([
        multipartBytes("upload-boundary", [
          { name: "name", value: "Artifact" },
          {
            name: "file",
            filename: "artifact.zip",
            contentType: "application/zip",
            body: encoder.encode("zip")
          },
          { name: "extra", value: "No" }
        ])
      ]),
      { maxArchiveBytes: 20 }
    );
    await expectCode(excessParts.completed, "too_many_parts");
  });

  it("rejects oversized headers through Busboy's configured limits", async () => {
    const namePart =
      "--upload-boundary\r\n" +
      'Content-Disposition: form-data; name="name"\r\n' +
      "Content-Type: text/plain; charset=utf-8\r\n\r\n" +
      "Artifact\r\n";
    const oversizedHeader =
      namePart +
      "--upload-boundary\r\n" +
      `X-Fill: ${"a".repeat(1_100)}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="artifact.zip"\r\n' +
      "Content-Type: application/zip\r\n\r\nzip\r\n" +
      "--upload-boundary--\r\n";
    const largeHeaders = parseArtifactMultipartUpload(
      requestFromChunks([encoder.encode(oversizedHeader)]),
      { maxArchiveBytes: 20 }
    );
    const excessiveHeaderPairs =
      namePart +
      "--upload-boundary\r\n" +
      Array.from({ length: 9 }, (_, index) => `X-Test-${index}: value\r\n`).join("") +
      'Content-Disposition: form-data; name="file"; filename="artifact.zip"\r\n' +
      "Content-Type: application/zip\r\n\r\nzip\r\n" +
      "--upload-boundary--\r\n";
    const manyHeaders = parseArtifactMultipartUpload(
      requestFromChunks([encoder.encode(excessiveHeaderPairs)]),
      { maxArchiveBytes: 20 }
    );
    await expectCode(largeHeaders.completed, "missing_file");
    await expectCode(manyHeaders.completed, "missing_file");
  });

  it("maps Busboy's malformed closing-boundary error", async () => {
    const malformed = parseArtifactMultipartUpload(
      requestFromChunks([
        multipartBytes(
          "upload-boundary",
          [
            { name: "name", value: "Artifact" },
            {
              name: "file",
              filename: "artifact.zip",
              contentType: "application/zip",
              body: encoder.encode("zip")
            }
          ],
          false
        )
      ]),
      { maxArchiveBytes: 20 }
    );
    const consumption = collect(malformed.file);
    void consumption.catch(() => undefined);

    await expectCode(malformed.completed, "invalid_part_headers");
  });

  it("uses a typed error class", () => {
    const error = new MultipartUploadError("missing_file", "File is required.");

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("missing_file");
  });
});
