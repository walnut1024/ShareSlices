import { createHash } from "node:crypto";

const referencePattern = /^(secret|kubernetes-secret|cloudflare-secret):\/\/([A-Za-z0-9._/-]+)$/;
const redacted = "[REDACTED]";

export function parseSecretReference(reference) {
  if (!reference || typeof reference !== "object") {
    throw new TypeError("Secret reference must be an object.");
  }
  const match = referencePattern.exec(reference.ref ?? "");
  if (!match || typeof reference.revision !== "string" || reference.revision.length === 0) {
    throw new TypeError("Secret reference is invalid.");
  }
  return Object.freeze({
    scheme: match[1],
    logicalPath: match[2],
    revision: reference.revision,
  });
}

export async function withResolvedSecret(reference, resolvers, operation) {
  const parsed = parseSecretReference(reference);
  const resolver = resolvers[parsed.scheme];
  if (typeof resolver !== "function") {
    throw new TypeError(`No resolver is configured for ${parsed.scheme}.`);
  }
  const value = await resolver(parsed);
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Secret resolver returned an invalid value.");
  }
  return operation(value, parsed);
}

function derivedRepresentations(value) {
  const hash = createHash("sha256").update(value).digest();
  return [
    value,
    hash.toString("hex"),
    `sha256:${hash.toString("hex")}`,
    hash.toString("base64"),
    hash.toString("base64url"),
  ];
}

function redactString(value, sensitive) {
  let output = value;
  for (const token of sensitive) {
    if (token.length > 0) output = output.replaceAll(token, redacted);
  }
  return output;
}

export function redactSecretMaterial(value, secretValues) {
  const sensitive = [...new Set(secretValues.flatMap(derivedRepresentations))]
    .sort((left, right) => right.length - left.length);
  const visit = (current) => {
    if (typeof current === "string") return redactString(current, sensitive);
    if (Array.isArray(current)) return current.map(visit);
    if (current && typeof current === "object") {
      return Object.fromEntries(Object.entries(current).map(([key, child]) => [key, visit(child)]));
    }
    return current;
  };
  return visit(value);
}

export function affectedSecretConsumers(previous, next, bindings) {
  const previousRevisions = new Map(previous.map(({ logicalId, revision }) => [logicalId, revision]));
  const nextRevisions = new Map(next.map(({ logicalId, revision }) => [logicalId, revision]));
  const changed = new Set(
    [...new Set([...previousRevisions.keys(), ...nextRevisions.keys()])]
      .filter((logicalId) => previousRevisions.get(logicalId) !== nextRevisions.get(logicalId)),
  );
  return [...new Set(
    bindings
      .filter(({ logicalId }) => changed.has(logicalId))
      .flatMap(({ consumers }) => consumers),
  )].sort();
}

export function planSharedSigningKeyRotation(input) {
  if (input.oldRevision === input.newRevision) return Object.freeze({ kind: "unchanged", phases: [] });
  if (!input.overlapSupported || !Number.isSafeInteger(input.maximumLifetimeSeconds) || input.maximumLifetimeSeconds <= 0) {
    return Object.freeze({
      kind: "refused",
      reasonCode: "signing_key_overlap_unavailable",
      phases: [],
    });
  }
  return Object.freeze({
    kind: "staged",
    phases: [
      { action: "verify", revisions: [input.oldRevision, input.newRevision] },
      { action: "sign", revision: input.newRevision },
      {
        action: "retire_verification",
        revision: input.oldRevision,
        notBeforeSeconds: input.maximumLifetimeSeconds,
      },
    ],
  });
}
