import {HeadObjectCommand, S3Client} from "@aws-sdk/client-s3";

import {withResolvedSecret} from "../automation/secrets.mjs";

// cspell:ignore dockerconfigjson identitytoken
const credentialSchemaVersion = "shareslices.release-store-pull/v1";
const manifestAccept = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

function parseReleaseStoreCredential(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("Release-store credential is not valid JSON.");
  }
  const requiredStrings = ["endpoint", "region", "bucket", "namespace", "accessKeyId", "secretAccessKey"];
  if (
    parsed?.schemaVersion !== credentialSchemaVersion ||
    requiredStrings.some((name) => typeof parsed[name] !== "string" || parsed[name].length === 0) ||
    ![undefined, true, false].includes(parsed.forcePathStyle)
  ) {
    throw new TypeError("Release-store credential does not match the supported pull contract.");
  }
  const endpoint = new URL(parsed.endpoint);
  if (endpoint.protocol !== "https:") {
    throw new TypeError("Release-store endpoint must use HTTPS.");
  }
  return Object.freeze({
    endpoint: endpoint.href,
    region: parsed.region,
    bucket: parsed.bucket,
    namespace: parsed.namespace.replace(/^\/+|\/+$/g, ""),
    accessKeyId: parsed.accessKeyId,
    secretAccessKey: parsed.secretAccessKey,
    sessionToken: typeof parsed.sessionToken === "string" && parsed.sessionToken.length > 0
      ? parsed.sessionToken
      : undefined,
    forcePathStyle: parsed.forcePathStyle === true,
  });
}

function releaseManifestKey(namespace, releaseId) {
  if (!namespace || !/^sha256:[a-f0-9]{64}$/.test(releaseId ?? "")) {
    throw new TypeError("Release-store access requires a namespace and immutable release ID.");
  }
  return `${namespace}/releases/${releaseId.slice("sha256:".length)}/release.json`;
}

export function createReleaseStoreAccessProbe({resolvers, S3ClientClass = S3Client} = {}) {
  return async ({reference, release}) => withResolvedSecret(reference, resolvers ?? {}, async (value) => {
    const credential = parseReleaseStoreCredential(value);
    const client = new S3ClientClass({
      endpoint: credential.endpoint,
      region: credential.region,
      forcePathStyle: credential.forcePathStyle,
      credentials: {
        accessKeyId: credential.accessKeyId,
        secretAccessKey: credential.secretAccessKey,
        ...(credential.sessionToken ? {sessionToken: credential.sessionToken} : {}),
      },
    });
    try {
      const response = await client.send(new HeadObjectCommand({
        Bucket: credential.bucket,
        Key: releaseManifestKey(credential.namespace, release?.releaseId),
      }));
      return Number.isInteger(response?.ContentLength) && response.ContentLength > 0;
    } finally {
      client.destroy?.();
    }
  });
}

function parseRepository(repository) {
  if (typeof repository !== "string" || repository.includes("://")) {
    throw new TypeError("OCI repository must omit a URL scheme.");
  }
  const separator = repository.indexOf("/");
  if (separator <= 0 || separator === repository.length - 1) {
    throw new TypeError("OCI repository must include a registry and namespace.");
  }
  return Object.freeze({registry: repository.slice(0, separator), namespace: repository.slice(separator + 1)});
}

function parseDockerConfig(encoded, registry) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(encoded.trim(), "base64").toString("utf8"));
  } catch {
    throw new TypeError("Kubernetes registry pull Secret is not valid Docker configuration.");
  }
  const auths = parsed?.auths;
  if (!auths || typeof auths !== "object") {
    throw new TypeError("Kubernetes registry pull Secret has no auth entries.");
  }
  const entry = auths[registry] ?? auths[`https://${registry}`] ?? auths[`https://${registry}/v1/`];
  if (!entry || typeof entry !== "object") {
    throw new TypeError("Kubernetes registry pull Secret does not cover the configured registry.");
  }
  if (typeof entry.identitytoken === "string" && entry.identitytoken.length > 0) {
    return Object.freeze({authorization: `Bearer ${entry.identitytoken}`, basic: null});
  }
  if (typeof entry.auth === "string" && entry.auth.length > 0) {
    return Object.freeze({authorization: `Basic ${entry.auth}`, basic: `Basic ${entry.auth}`});
  }
  throw new TypeError("Kubernetes registry pull Secret has no supported pull credential.");
}

function parseBearerChallenge(value) {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  if (!match) return null;
  const fields = Object.fromEntries([...match[1].matchAll(/([A-Za-z]+)="([^"]*)"/g)]
    .map(([, name, fieldValue]) => [name.toLowerCase(), fieldValue]));
  if (!fields.realm) return null;
  const realm = new URL(fields.realm);
  if (realm.protocol !== "https:") throw new TypeError("OCI token realm must use HTTPS.");
  return Object.freeze({realm, service: fields.service, scope: fields.scope});
}

async function bearerToken(challenge, basic, fetchImpl) {
  const url = new URL(challenge.realm);
  if (challenge.service) url.searchParams.set("service", challenge.service);
  if (challenge.scope) url.searchParams.set("scope", challenge.scope);
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    headers: basic ? {authorization: basic} : {},
  });
  if (!response.ok) return null;
  const body = await response.json();
  const token = body?.token ?? body?.access_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

async function headManifest(url, digest, credential, fetchImpl) {
  const request = (authorization) => fetchImpl(url, {
    method: "HEAD",
    redirect: "error",
    headers: {accept: manifestAccept, ...(authorization ? {authorization} : {})},
  });
  let response = await request(credential.authorization);
  if (response.status === 401) {
    const challenge = parseBearerChallenge(response.headers.get("www-authenticate"));
    if (!challenge) return false;
    const token = await bearerToken(challenge, credential.basic, fetchImpl);
    if (!token) return false;
    response = await request(`Bearer ${token}`);
  }
  return response.status === 200 && response.headers.get("docker-content-digest") === digest;
}

export function createOciImageAvailabilityProbe({fetchImpl = fetch} = {}) {
  return async ({config, repository, images, runKubectl}) => {
    if (typeof runKubectl !== "function") throw new TypeError("OCI probe requires Kubernetes read access.");
    const {registry, namespace} = parseRepository(repository);
    const secret = runKubectl([
      "--context", config.kubernetes.context,
      "--namespace", config.kubernetes.namespace,
      "get", "secret", config.kubernetes.registry.pullSecretName,
      "--output=jsonpath={.data.\\.dockerconfigjson}",
    ]);
    if (secret.status !== 0 || secret.stdout.trim().length === 0) return {availableDigests: []};
    const credential = parseDockerConfig(secret.stdout, registry);
    const availableDigests = [];
    for (const {name, digest} of images) {
      if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name) || !/^sha256:[a-f0-9]{64}$/.test(digest)) continue;
      const url = new URL(`https://${registry}/v2/${namespace}/${name}/manifests/${digest}`);
      if (await headManifest(url, digest, credential, fetchImpl)) availableDigests.push(digest);
    }
    return Object.freeze({availableDigests: Object.freeze(availableDigests)});
  };
}
