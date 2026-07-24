import {createDatabaseConnection} from "../db/connection.js";
import {createReleaseVerificationRepository} from "./release-verification-repository.js";

type Bindings = Readonly<{
  HYPERDRIVE: Readonly<{connectionString: string}>;
}>;

const INTERNAL_ORIGIN = "http://shareslices-release-verifier.internal";
const MAXIMUM_BODY_BYTES = 8 * 1024;

function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: {"Cache-Control": "no-store"},
  });
}

function parseBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== 11 ||
    body.version !== 1 ||
    typeof body.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(body.nonce) ||
    typeof body.releaseId !== "string" ||
    body.releaseId.length < 1 ||
    body.releaseId.length > 256 ||
    !Number.isSafeInteger(body.fence) ||
    Number(body.fence) <= 0 ||
    !Number.isSafeInteger(body.subFence) ||
    Number(body.subFence) <= 0 ||
    (body.containerClass !== "trusted-processing" &&
      body.containerClass !== "thumbnail") ||
    typeof body.stableSlot !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,127}$/.test(body.stableSlot) ||
    typeof body.providerInstance !== "string" ||
    body.providerInstance.length < 1 ||
    body.providerInstance.length > 256 ||
    typeof body.buildIdentity !== "string" ||
    body.buildIdentity.length < 1 ||
    body.buildIdentity.length > 512 ||
    typeof body.contractRevision !== "string" ||
    body.contractRevision.length < 1 ||
    body.contractRevision.length > 256 ||
    typeof body.imageReference !== "string" ||
    body.imageReference.length < 1 ||
    body.imageReference.length > 512
  ) {
    return null;
  }
  return body as {
    version: 1;
    nonce: string;
    releaseId: string;
    fence: number;
    subFence: number;
    containerClass: "trusted-processing" | "thumbnail";
    stableSlot: string;
    providerInstance: string;
    buildIdentity: string;
    contractRevision: string;
    imageReference: string;
  };
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("container_evidence_body_missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > MAXIMUM_BODY_BYTES) {
      await reader.cancel();
      throw new Error("container_evidence_body_too_large");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
}

export function createContainerReleaseVerificationBroker() {
  return async (
    request: Request,
    bindings: Bindings,
    controllerInstance: string,
  ): Promise<Response> => {
    const url = new URL(request.url);
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (
      request.method !== "POST" ||
      url.origin !== INTERNAL_ORIGIN ||
      url.pathname !== "/v1/container-evidence" ||
      !controllerInstance ||
      controllerInstance.length > 256 ||
      !Number.isSafeInteger(declaredLength) ||
      declaredLength > MAXIMUM_BODY_BYTES
    ) {
      return notFound();
    }
    let body: ReturnType<typeof parseBody>;
    try {
      body = parseBody(await readBoundedJson(request));
    } catch {
      return notFound();
    }
    if (!body) return notFound();
    const connection = createDatabaseConnection({
      mode: "hyperdrive",
      cache: "disabled",
      connectionString: bindings.HYPERDRIVE.connectionString,
      maxConnections: 1,
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 1_000,
    });
    try {
      const recorded = await createReleaseVerificationRepository(connection)
        .recordContainerEvidence({
          ...body,
          controllerInstance,
        });
      return recorded
        ? new Response(null, {
          status: 204,
          headers: {"Cache-Control": "no-store"},
        })
        : notFound();
    } finally {
      await connection.close();
    }
  };
}
