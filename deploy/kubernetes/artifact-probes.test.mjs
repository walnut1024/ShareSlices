import assert from "node:assert/strict";
import test from "node:test";

import {
  createOciImageAvailabilityProbe,
  createReleaseStoreAccessProbe,
} from "./artifact-probes.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const reference = {ref: "secret://release-store/deploy-pull", revision: "5"};

function credential(overrides = {}) {
  return JSON.stringify({
    schemaVersion: "shareslices.release-store-pull/v1",
    endpoint: "https://objects.example.test",
    region: "us-east-1",
    bucket: "shareslices-releases",
    namespace: "enterprise-production",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    forcePathStyle: true,
    ...overrides,
  });
}

test("release-store probe heads the exact immutable release object without returning credentials", async () => {
  const clients = [];
  class FakeS3Client {
    constructor(options) {
      this.options = options;
      this.commands = [];
      clients.push(this);
    }
    async send(command) {
      this.commands.push(command);
      return {ContentLength: 4096};
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const probe = createReleaseStoreAccessProbe({
    resolvers: {secret: async () => credential()},
    S3ClientClass: FakeS3Client,
  });
  const result = await probe({reference, release: {releaseId: digest("a")}});
  assert.equal(result, true);
  assert.deepEqual(clients[0].commands[0].input, {
    Bucket: "shareslices-releases",
    Key: `enterprise-production/releases/${"a".repeat(64)}/release.json`,
  });
  assert.equal(clients[0].destroyed, true);
  assert.equal(JSON.stringify(result).includes("secret-key"), false);
});

test("release-store probe refuses plaintext endpoints, malformed credentials, and empty objects", async () => {
  for (const value of ["not-json", credential({endpoint: "http://objects.example.test"})]) {
    const probe = createReleaseStoreAccessProbe({
      resolvers: {secret: async () => value},
      S3ClientClass: class {},
    });
    await assert.rejects(probe({reference, release: {releaseId: digest("a")}}));
  }

  class EmptyS3Client {
    async send() { return {ContentLength: 0}; }
  }
  const probe = createReleaseStoreAccessProbe({
    resolvers: {secret: async () => credential()},
    S3ClientClass: EmptyS3Client,
  });
  assert.equal(await probe({reference, release: {releaseId: digest("a")}}), false);
});

test("OCI probe authenticates and heads every immutable manifest digest", async () => {
  const requests = [];
  const basic = Buffer.from("user:pass").toString("base64");
  const fetchImpl = async (url, options) => {
    requests.push({url: String(url), options});
    if (String(url).startsWith("https://auth.example.test/token")) {
      return new Response(JSON.stringify({token: "pull-token"}), {status: 200});
    }
    if (options.headers.authorization === `Basic ${basic}`) {
      return new Response(null, {
        status: 401,
        headers: {"www-authenticate": "Bearer realm=\"https://auth.example.test/token\",service=\"registry.example.test\",scope=\"repository:shareslices/api-image:pull\""},
      });
    }
    const requestedDigest = String(url).slice(String(url).lastIndexOf("/") + 1);
    return new Response(null, {status: 200, headers: {"docker-content-digest": requestedDigest}});
  };
  const dockerConfig = Buffer.from(JSON.stringify({
    auths: {"registry.example.test": {auth: basic}},
  })).toString("base64");
  const runKubectl = (arguments_) => ({status: 0, stdout: dockerConfig, stderr: "", arguments_});
  const images = [{name: "api-image", digest: digest("a")}, {name: "web-image", digest: digest("b")}];
  const probe = createOciImageAvailabilityProbe({fetchImpl});
  const result = await probe({
    config: {kubernetes: {context: "production", namespace: "shareslices", registry: {pullSecretName: "pull"}}},
    repository: "registry.example.test/shareslices",
    images,
    runKubectl,
  });
  assert.deepEqual(result.availableDigests, images.map(({digest: value}) => value));
  assert.equal(requests.filter(({options}) => options.method === "HEAD").length, 4);
  assert.equal(requests.every(({options}) => options.redirect === "error"), true);
  assert.equal(JSON.stringify(result).includes(basic), false);
});

test("OCI probe fails closed on a mismatched digest or unusable pull Secret", async () => {
  const basic = Buffer.from("user:pass").toString("base64");
  const probe = createOciImageAvailabilityProbe({
    fetchImpl: async () => new Response(null, {
      status: 200,
      headers: {"docker-content-digest": digest("f")},
    }),
  });
  const input = {
    config: {kubernetes: {context: "production", namespace: "shareslices", registry: {pullSecretName: "pull"}}},
    repository: "registry.example.test/shareslices",
    images: [{name: "api-image", digest: digest("a")}],
  };
  const absent = await probe({...input, runKubectl: () => ({status: 1, stdout: "", stderr: "denied"})});
  assert.deepEqual(absent.availableDigests, []);
  const encoded = Buffer.from(JSON.stringify({auths: {"registry.example.test": {auth: basic}}})).toString("base64");
  const mismatch = await probe({...input, runKubectl: () => ({status: 0, stdout: encoded, stderr: ""})});
  assert.deepEqual(mismatch.availableDigests, []);
});
