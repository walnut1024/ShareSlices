import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const connectionVariables = [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
];
const lockRoot = join(tmpdir(), "shareslices-compose-locks");

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || "no diagnostic output";
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

function normalizePath(path, workingDirectory) {
  return isAbsolute(path) ? path : resolve(workingDirectory, path);
}

export function rejectConflictingDockerControls(environment = process.env) {
  if (environment.DOCKER_HOST && environment.DOCKER_CONTEXT) {
    throw new Error("DOCKER_HOST and DOCKER_CONTEXT cannot both select the Docker endpoint");
  }
  if ((environment.DOCKER_TLS_VERIFY || environment.DOCKER_CERT_PATH) && !environment.DOCKER_HOST) {
    throw new Error("Docker TLS controls require an explicit DOCKER_HOST");
  }
}

export function resolveDockerSnapshot({
  environment = process.env,
  workingDirectory = process.cwd(),
  executeCommand = execute,
} = {}) {
  rejectConflictingDockerControls(environment);
  const dockerConfig = normalizePath(
    environment.DOCKER_CONFIG ?? join(environment.HOME ?? "", ".docker"),
    workingDirectory,
  );
  let host = environment.DOCKER_HOST;
  let contextName = null;
  let skipTlsVerify = false;
  let tlsPath = null;

  if (!host) {
    contextName = environment.DOCKER_CONTEXT
      ?? executeCommand("docker", ["context", "show"], { cwd: workingDirectory, env: environment });
    const context = JSON.parse(
      executeCommand("docker", ["context", "inspect", contextName, "--format", "{{json .}}"], {
        cwd: workingDirectory,
        env: environment,
      }),
    );
    host = context.Endpoints?.docker?.Host;
    skipTlsVerify = context.Endpoints?.docker?.SkipTLSVerify === true;
    tlsPath = context.Storage?.TLSPath ?? null;
  } else if (environment.DOCKER_CERT_PATH) {
    tlsPath = normalizePath(environment.DOCKER_CERT_PATH, workingDirectory);
    skipTlsVerify = environment.DOCKER_TLS_VERIFY !== "1";
  }

  if (!host) throw new Error("Selected Docker connection has no endpoint");
  const connectionArgs = ["--host", host];
  if (tlsPath && !host.startsWith("unix://")) {
    const ca = join(tlsPath, "ca.pem");
    const certificate = join(tlsPath, "cert.pem");
    const key = join(tlsPath, "key.pem");
    for (const path of [ca, certificate, key]) statSync(path);
    connectionArgs.push(
      skipTlsVerify ? "--tls" : "--tlsverify",
      "--tlscacert", ca,
      "--tlscert", certificate,
      "--tlskey", key,
    );
  }
  return Object.freeze({
    connectionArgs: Object.freeze(connectionArgs),
    contextName,
    dockerConfig,
    host,
  });
}

export function dockerEnvironment(snapshot, environment = process.env) {
  return Object.freeze({
    DOCKER_CONFIG: snapshot.dockerConfig,
    PATH: environment.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  });
}

export function observeEngineId(snapshot, options = {}) {
  const raw = (options.executeCommand ?? execute)(
    "docker",
    [...snapshot.connectionArgs, "info", "--format", "{{json .ID}}"],
    { cwd: options.cwd, env: options.env },
  );
  const engineId = JSON.parse(raw);
  if (typeof engineId !== "string" || engineId.length === 0) {
    throw new Error("Docker Engine returned no stable server ID");
  }
  return engineId;
}

function lockName(kind, identity, project) {
  return createHash("sha256").update(`${kind}\0${identity}\0${project}`).digest("hex");
}

function acquireLock(kind, identity, project, timeoutMs = 30_000) {
  mkdirSync(lockRoot, { recursive: true, mode: 0o700 });
  const path = join(lockRoot, lockName(kind, identity, project));
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      mkdirSync(path, { mode: 0o700 });
      writeFileSync(join(path, "owner.json"), `${JSON.stringify({ pid: process.pid, project })}\n`, {
        mode: 0o600,
      });
      return () => rmSync(path, { force: true, recursive: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        let owner = "unknown owner";
        try {
          owner = readFileSync(join(path, "owner.json"), "utf8").trim();
        } catch {
          // The owner may still be writing its diagnostic record.
        }
        throw new Error(`Timed out waiting for ${kind}/${project} Docker lock (${owner})`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

export function withDockerMutationController(snapshot, project, operation, options = {}) {
  const releaseEndpoint = acquireLock("endpoint", snapshot.host, project, options.timeoutMs);
  let releaseEngine;
  try {
    const engineId = observeEngineId(snapshot, options);
    releaseEngine = acquireLock("engine", engineId, project, options.timeoutMs);
    const confirmEngine = () => {
      const observed = observeEngineId(snapshot, options);
      if (observed !== engineId) {
        throw new Error(
          "Docker Engine identity changed; operation is indeterminate and no action may continue under the stale Engine lock",
        );
      }
    };
    confirmEngine();
    const result = operation({
      engineId,
      runMutation(command, args, runOptions = {}) {
        confirmEngine();
        const value = (options.executeCommand ?? execute)(command, args, runOptions);
        confirmEngine();
        return value;
      },
    });
    confirmEngine();
    return result;
  } finally {
    releaseEngine?.();
    releaseEndpoint();
  }
}

export function runPinnedReadOnly(snapshot, command, args, options = {}) {
  const before = observeEngineId(snapshot, options);
  const result = (options.executeCommand ?? execute)(command, args, options.runOptions);
  const after = observeEngineId(snapshot, options);
  if (before !== after) {
    throw new Error("Docker Engine identity changed during the read-only operation; result is indeterminate");
  }
  return result;
}

export const dockerConnectionVariables = Object.freeze(connectionVariables);
