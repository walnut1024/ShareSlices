// cspell:words automount
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const roots = ["base", "overlays/direct", "overlays/external-cdn"];

function render(root) {
  return execFileSync("kubectl", ["kustomize", `deploy/kubernetes/${root}`], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
}

test("all checked Kubernetes compositions render deterministically", () => {
  for (const root of roots) {
    assert.equal(render(root), render(root), root);
  }
});

test("base uses discovery, immutable images, external role Secrets, and one migration Job", () => {
  const output = render("base");
  assert.doesNotMatch(output, /kind: Secret\b/);
  assert.doesNotMatch(output, /\bclusterIP: /);
  assert.doesNotMatch(output, /\binitContainers:/);
  assert.doesNotMatch(output, /10\.96\./);
  assert.doesNotMatch(output, /replace-(?:me|with)/);
  for (const line of output.split("\n").filter((entry) => entry.trim().startsWith("image: "))) {
    assert.match(line, /@sha256:[a-f0-9]{64}$/);
  }
  assert.equal((output.match(/^kind: Job$/gm) ?? []).length, 1);
  assert.match(output, /name: shareslices-migrate-release/);
  for (const secret of ["api", "maintenance", "content", "worker", "migration"]) {
    assert.match(output, new RegExp(`name: shareslices-${secret}-secrets`));
  }
});

test("every resident workload is least privilege with bounded resources and valid probes", () => {
  const output = render("base");
  assert.equal((output.match(/automountServiceAccountToken: false/g) ?? []).length >= 12, true);
  assert.equal((output.match(/allowPrivilegeEscalation: false/g) ?? []).length, 6);
  assert.equal((output.match(/readOnlyRootFilesystem: true/g) ?? []).length, 6);
  assert.equal((output.match(/type: RuntimeDefault/g) ?? []).length >= 6, true);
  assert.equal((output.match(/drop:\n\s+- ALL/g) ?? []).length, 6);
  assert.equal((output.match(/resources:\n/g) ?? []).length, 6);
  assert.match(output, /path: \/web-health/);
  assert.match(output, /path: \/ready/);
  assert.match(output, /path: \/health/);
  assert.match(output, /command:\n\s+- shareslices-worker\n\s+- healthcheck/);
  assert.match(output, /terminationGracePeriodSeconds: 45/);
});

test("direct and external-CDN overlays differ only by the explicit CDN contract module", () => {
  const direct = render("overlays/direct");
  const external = render("overlays/external-cdn");
  for (const output of [direct, external]) {
    assert.match(output, /kind: Ingress/);
    assert.match(output, /name: shareslices-app/);
    assert.match(output, /name: shareslices-content/);
    assert.match(output, /host: app\.invalid/);
    assert.match(output, /host: content\.invalid/);
  }
  assert.doesNotMatch(direct, /name: shareslices-external-cdn-contract/);
  assert.match(external, /name: shareslices-external-cdn-contract/);
  assert.match(external, /provisioning: external-prerequisite/);
  assert.doesNotMatch(external, /cloudflare/i);
});
