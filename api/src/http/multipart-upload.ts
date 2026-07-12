import { Busboy, type BusboyFileStream } from "@fastify/busboy";

const NAME_SIZE_BYTES = 512;
const PART_HEADER_BYTES = 1_024;
const PART_HEADER_PAIRS = 8;
const FIELD_NAME_BYTES = 16;

export type MultipartUploadErrorCode =
  | "invalid_content_type"
  | "invalid_boundary"
  | "invalid_limit"
  | "missing_name"
  | "missing_file"
  | "duplicate_name"
  | "duplicate_entry"
  | "duplicate_file"
  | "unknown_part"
  | "invalid_name_encoding"
  | "name_too_large"
  | "invalid_file_type"
  | "archive_too_large"
  | "too_many_parts"
  | "invalid_part_headers"
  | "stream_interrupted"
  | "consumer_aborted";

export class MultipartUploadError extends Error {
  readonly code: MultipartUploadErrorCode;

  constructor(code: MultipartUploadErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MultipartUploadError";
    this.code = code;
  }
}

export type ArtifactMultipartUpload = {
  name: Promise<string>;
  requestedEntry: Promise<string | null>;
  file: AsyncIterable<Uint8Array>;
  completed: Promise<void>;
  abort(): void;
};

export type ArtifactMultipartUploadOptions = {
  maxArchiveBytes: number;
  requireName?: boolean;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function multipartBoundary(contentType: string | null): string {
  if (contentType === null) {
    throw new MultipartUploadError("invalid_content_type", "Content-Type is required.");
  }

  const segments = contentType.split(";").map((segment) => segment.trim());
  if (segments.shift()?.toLowerCase() !== "multipart/form-data") {
    throw new MultipartUploadError(
      "invalid_content_type",
      "Content-Type must be multipart/form-data."
    );
  }

  const boundaries = segments
    .map((segment) => /^boundary=(.*)$/i.exec(segment)?.[1])
    .filter((value): value is string => value !== undefined);
  const encoded = boundaries[0];
  if (boundaries.length !== 1 || encoded === undefined) {
    throw new MultipartUploadError("invalid_boundary", "One multipart boundary is required.");
  }

  const boundary =
    encoded.startsWith('"') && encoded.endsWith('"') ? encoded.slice(1, -1) : encoded;
  if (!/^[0-9A-Za-z'()+_,./:=?-]{1,70}$/.test(boundary)) {
    throw new MultipartUploadError("invalid_boundary", "Multipart boundary is invalid.");
  }
  return boundary;
}

function asUploadError(error: unknown): MultipartUploadError {
  if (error instanceof MultipartUploadError) {
    return error;
  }
  return new MultipartUploadError("invalid_part_headers", "Multipart body is malformed.", {
    cause: error
  });
}

export function parseArtifactMultipartUpload(
  request: Request,
  options: ArtifactMultipartUploadOptions
): ArtifactMultipartUpload {
  if (!Number.isSafeInteger(options.maxArchiveBytes) || options.maxArchiveBytes <= 0) {
    throw new MultipartUploadError("invalid_limit", "Archive byte limit must be a positive integer.");
  }

  const boundary = multipartBoundary(request.headers.get("content-type"));
  const requireName = options.requireName ?? true;
  const name = deferred<string>();
  const requestedEntry = deferred<string | null>();
  const file = deferred<BusboyFileStream>();
  const completed = deferred<void>();
  const reader = request.body?.getReader();
  let terminalError: MultipartUploadError | undefined;
  let nameSeen = false;
  let entrySeen = false;
  let fileSeen = false;
  let fileStream: BusboyFileStream | undefined;
  let fileConsumed = false;

  const parser = Busboy({
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    limits: {
      fieldNameSize: FIELD_NAME_BYTES,
      fieldSize: NAME_SIZE_BYTES,
      fields: requireName ? 2 : 1,
      fileSize: options.maxArchiveBytes,
      files: 1,
      parts: requireName ? 3 : 2,
      headerPairs: PART_HEADER_PAIRS,
      headerSize: PART_HEADER_BYTES
    }
  });

  function fail(error: MultipartUploadError, destroyFileWithError = true): MultipartUploadError {
    if (terminalError !== undefined) {
      return terminalError;
    }
    terminalError = error;
    name.reject(error);
    requestedEntry.reject(error);
    file.reject(error);
    completed.reject(error);

    if (fileStream !== undefined && !fileStream.destroyed) {
      fileStream.destroy(destroyFileWithError ? error : undefined);
    }
    if (!parser.destroyed) {
      parser.destroy();
    }
    void reader?.cancel(error).catch(() => undefined);
    return error;
  }

  parser.on(
    "field",
    (fieldName, value, fieldNameTruncated, valueTruncated, _encoding, mimeType) => {
      if (fieldName === "entry") {
        if (entrySeen) {
          fail(new MultipartUploadError("duplicate_entry", "Multipart entry field is duplicated."));
          return;
        }
        entrySeen = true;
        if (fieldNameTruncated || valueTruncated || mimeType !== "text/plain" || value.includes("\uFFFD")) {
          fail(new MultipartUploadError("invalid_name_encoding", "Multipart entry field must be UTF-8 text."));
          return;
        }
        requestedEntry.resolve(value);
        return;
      }
      if (!requireName) {
        fail(new MultipartUploadError("unknown_part", `Unexpected multipart field: ${fieldName}.`));
        return;
      }
      if (fieldName !== "name") {
        fail(new MultipartUploadError("unknown_part", `Unexpected multipart field: ${fieldName}.`));
        return;
      }
      if (nameSeen) {
        fail(new MultipartUploadError("duplicate_name", "Multipart name field is duplicated."));
        return;
      }
      nameSeen = true;
      if (fieldNameTruncated || valueTruncated) {
        fail(new MultipartUploadError("name_too_large", "Multipart name field is too large."));
        return;
      }
      if (mimeType !== "text/plain" || value.includes("\uFFFD")) {
        fail(
          new MultipartUploadError(
            "invalid_name_encoding",
            "Multipart name field must be UTF-8 text."
          )
        );
        return;
      }
      name.resolve(value);
    }
  );

  parser.on("file", (fieldName, stream, filename, _encoding, mimeType) => {
    fileStream = stream;
    stream.on("error", (error) => {
      if (terminalError === undefined) {
        fail(asUploadError(error));
      }
    });

    if (fieldName !== "file") {
      fail(new MultipartUploadError("unknown_part", `Unexpected multipart file: ${fieldName}.`));
      return;
    }
    if (fileSeen) {
      fail(new MultipartUploadError("duplicate_file", "Multipart file field is duplicated."));
      return;
    }
    fileSeen = true;
    if (mimeType !== "application/zip" || !filename.toLowerCase().endsWith(".zip")) {
      fail(
        new MultipartUploadError(
          "invalid_file_type",
          "Multipart file must be an application/zip file named with a .zip suffix."
        )
      );
      return;
    }

    stream.once("limit", () => {
      fail(
        new MultipartUploadError(
          "archive_too_large",
          "Multipart file exceeds the archive byte limit."
        )
      );
    });
    file.resolve(stream);
  });

  parser.once("fieldsLimit", () => {
    fail(
      new MultipartUploadError(
        nameSeen ? "duplicate_name" : "unknown_part",
        "Multipart body contains too many text fields."
      )
    );
  });
  parser.once("filesLimit", () => {
    fail(
      new MultipartUploadError(
        fileSeen ? "duplicate_file" : "unknown_part",
        "Multipart body contains too many file fields."
      )
    );
  });
  parser.once("partsLimit", () => {
    fail(new MultipartUploadError("too_many_parts", "Multipart body contains too many parts."));
  });
  parser.once("error", (error) => {
    fail(asUploadError(error));
  });
  parser.once("finish", () => {
    if (terminalError !== undefined) {
      return;
    }
    if (requireName && !nameSeen) {
      fail(new MultipartUploadError("missing_name", "Multipart name field is required."));
      return;
    }
    if (!fileSeen) {
      fail(new MultipartUploadError("missing_file", "Multipart file field is required."));
      return;
    }
    if (!entrySeen) requestedEntry.resolve(null);
    if (!requireName) {
      name.resolve("");
    }
    completed.resolve();
  });

  async function pumpRequest(): Promise<void> {
    if (reader === undefined) {
      fail(new MultipartUploadError("stream_interrupted", "Multipart request body is missing."));
      return;
    }
    try {
      while (terminalError === undefined) {
        const chunk = await reader.read();
        if (chunk.done) {
          parser.end();
          return;
        }
        await new Promise<void>((resolve, reject) => {
          parser.write(Buffer.from(chunk.value), (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      }
    } catch (error) {
      if (terminalError === undefined) {
        fail(
          error instanceof MultipartUploadError
            ? error
            : new MultipartUploadError(
                "stream_interrupted",
                "Multipart request stream was interrupted.",
                { cause: error }
              )
        );
      }
    }
  }

  const fileBody: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      if (fileConsumed) {
        throw new MultipartUploadError("consumer_aborted", "Multipart file stream is single-use.");
      }
      fileConsumed = true;
      const stream = await file.promise;
      let reachedEnd = false;
      try {
        for await (const chunk of stream) {
          yield new Uint8Array(chunk);
        }
        if (terminalError !== undefined) {
          throw terminalError;
        }
        reachedEnd = true;
      } catch (error) {
        throw fail(
          terminalError ??
            new MultipartUploadError("stream_interrupted", "Multipart file stream was interrupted.", {
              cause: error
            })
        );
      } finally {
        if (!reachedEnd && terminalError === undefined) {
          fail(
            new MultipartUploadError(
              "consumer_aborted",
              "Multipart file consumer stopped before the file completed."
            ),
            false
          );
        }
      }
    }
  };

  void pumpRequest();
  return {
    name: name.promise,
    requestedEntry: requestedEntry.promise,
    file: fileBody,
    completed: completed.promise,
    abort() {
      fail(
        new MultipartUploadError("consumer_aborted", "Multipart upload was no longer needed."),
        false
      );
    }
  };
}
