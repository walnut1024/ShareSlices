import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compose = await readFile("deploy/compose/compose.yaml", "utf8");
const galleryOverlay = await readFile("deploy/compose/compose.gallery-local.yaml", "utf8");
const apiDockerfile = await readFile("api/Dockerfile", "utf8");
const workerDockerfile = await readFile("worker/Dockerfile", "utf8");

function serviceBlock(name) {
  const marker = `  ${name}:\n`;
  const start = compose.indexOf(marker);
  assert.notEqual(start, -1, `missing Compose service ${name}`);
  const next = compose.slice(start + marker.length).search(/^  [a-z][a-z0-9-]*:\n/m);
  return next === -1
    ? compose.slice(start)
    : compose.slice(start, start + marker.length + next);
}

test("canonical Compose declares every provider-neutral runtime role separately", () => {
  for (const service of [
    "postgres",
    "object-storage",
    "object-storage-init",
    "mailpit",
    "migrate",
    "api",
    "maintenance",
    "gallery-content",
    "worker",
    "web",
  ]) {
    serviceBlock(service);
  }
  assert.equal(/^\s+profiles:/m.test(compose), false);
  assert.equal(/^\s+container_name:/m.test(compose), false);
});

test("Node roles use distinct production entrypoints", () => {
  assert.match(apiDockerfile, /CMD \["node", "dist\/src\/main\.js"\]/);
  assert.match(serviceBlock("migrate"), /command: \["node", "dist\/src\/db\/migrate\.js"\]/);
  assert.match(
    serviceBlock("maintenance"),
    /command: \["node", "dist\/src\/maintenance\/main\.js"\]/,
  );
  assert.match(
    serviceBlock("gallery-content"),
    /command: \["node", "dist\/src\/content\/main\.js"\]/,
  );
  assert.doesNotMatch(serviceBlock("api"), /maintenance|content\/main|db\/migrate/);
  assert.doesNotMatch(serviceBlock("maintenance"), /^\s+ports:/m);
});

test("one-shot prerequisites gate application roles without becoming resident services", () => {
  assert.match(serviceBlock("object-storage-init"), /restart: "no"/);
  assert.match(serviceBlock("migrate"), /restart: "no"/);
  for (const service of ["api", "maintenance", "gallery-content", "worker"]) {
    assert.match(serviceBlock(service), /migrate:\n\s+condition: service_completed_successfully/);
    assert.match(
      serviceBlock(service),
      /object-storage-init:\n\s+condition: service_completed_successfully/,
    );
  }
});

test("resident processing remains a separate least-authority runtime", () => {
  const worker = serviceBlock("worker");
  assert.match(worker, /dockerfile: worker\/Dockerfile/);
  assert.match(workerDockerfile, /ENTRYPOINT \["shareslices-worker"\]/);
  assert.match(worker, /cap_drop:\n\s+- ALL/);
  assert.match(worker, /no-new-privileges:true/);
  assert.doesNotMatch(worker, /BETTER_AUTH_SECRET|AUTH_EMAIL_SMTP_URL|GALLERY_TURNSTILE_SECRET/);
});

test("content and maintenance roles do not receive another role's public authority", () => {
  const maintenance = serviceBlock("maintenance");
  const content = serviceBlock("gallery-content");
  assert.doesNotMatch(maintenance, /^\s+ports:/m);
  assert.doesNotMatch(content, /BETTER_AUTH_SECRET:/);
  assert.doesNotMatch(content, /AUTH_EMAIL_SMTP_URL:/);
  assert.doesNotMatch(content, /GALLERY_TURNSTILE_SECRET:/);
  const overlayContent = galleryOverlay.slice(galleryOverlay.indexOf("  gallery-content:"));
  assert.doesNotMatch(overlayContent, /GALLERY_TURNSTILE_SECRET:/);
  assert.doesNotMatch(galleryOverlay, /  migrate:/);
});
