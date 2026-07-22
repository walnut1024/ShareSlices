import net from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runGalleryConfigurationCheck } from "./gallery-config.mjs";
import {
  assertResidentServicesReady,
  composeFeatureBaseline,
  inspectComposeServices,
  verifyComposeCapabilities,
} from "./compose-capabilities.mjs";
import {
  dockerEnvironment,
  resolveDockerSnapshot,
  runPinnedReadOnly,
  withDockerMutationController,
} from "./docker-controller.mjs";
import {
  printComposeCoreVerification,
  runComposeCoreVerification,
} from "./verification-evidence.mjs";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const developerComposeArgs = [
  "compose",
  "--project-directory",
  repositoryRoot,
  "-p",
  "shareslices",
  "-f",
  "deploy/compose/compose.yaml",
  "-f",
  "deploy/compose/compose.gallery-local.yaml",
];
export const localEndpoints = {
  api: "http://app.localhost:5173/ready",
  content: "http://content.localhost:7460/ready",
  mailpit: "http://127.0.0.1:8025/readyz",
  web: "http://app.localhost:5173/web-health",
};
export const residentServices = Object.freeze([
  "postgres",
  "object-storage",
  "mailpit",
  "api",
  "maintenance",
  "gallery-content",
  "worker",
  "web",
]);

export function commandFor(action, extraArgs = []) {
  switch (action) {
    case "up":
      return [
        ...developerComposeArgs,
        "up", "-d", "--build", "--force-recreate", "--wait",
        "--wait-timeout", String(composeFeatureBaseline.waitTimeoutSeconds),
      ];
    case "down":
      return [...developerComposeArgs, "down"];
    case "status":
      return [...developerComposeArgs, "ps"];
    case "logs":
      return [...developerComposeArgs, "logs", "--follow", ...extraArgs];
    default:
      throw new Error(`Unknown local stack action: ${action}`);
  }
}

async function checkHttp(name, url) {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  console.log(`ready  ${name.padEnd(15)} ${url}`);
}

function checkTcp(name, host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(5_000);
    socket.once("connect", () => {
      socket.destroy();
      console.log(`ready  ${name.padEnd(15)} ${host}:${port}`);
      resolve();
    });
    socket.once("timeout", () => socket.destroy(new Error(`${name} timed out`)));
    socket.once("error", reject);
  });
}

export async function verifyLocalStack() {
  await checkHttp("Web", localEndpoints.web);
  await checkHttp("API", localEndpoints.api);
  await checkHttp("Gallery content", localEndpoints.content);
  await checkHttp("Mailpit", localEndpoints.mailpit);
  await checkTcp("SMTP", "127.0.0.1", 1025);
  const verification = await runComposeCoreVerification();
  printComposeCoreVerification(verification);
  if (verification.outcome !== "passed") {
    throw new Error("The shared read-only core verification contract failed.");
  }
}

function verifyComposeState(snapshot, environment) {
  const records = inspectComposeServices({
    connectionArgs: snapshot.connectionArgs,
    composeArgs: developerComposeArgs,
    environment,
  });
  assertResidentServicesReady(records, residentServices);
}

async function main() {
  const [action = "up", ...extraArgs] = process.argv.slice(2);
  const snapshot = resolveDockerSnapshot({ workingDirectory: repositoryRoot });
  const environment = dockerEnvironment(snapshot);
  const dockerArgs = [...snapshot.connectionArgs, ...commandFor(action, extraArgs)];
  if (action === "up" || action === "down") {
    verifyComposeCapabilities({
      connectionArgs: snapshot.connectionArgs,
      composeArgs: developerComposeArgs,
      environment,
    });
  }
  if (action === "up") {
    runGalleryConfigurationCheck({ connectionArgs: snapshot.connectionArgs, environment });
    withDockerMutationController(snapshot, "shareslices", ({ runMutation }) => {
      runMutation("docker", dockerArgs, { cwd: repositoryRoot, env: environment, stdio: "inherit" });
    }, { cwd: repositoryRoot, env: environment });
    verifyComposeState(snapshot, environment);
    await verifyLocalStack();
    console.log("\nShareSlices: http://app.localhost:5173");
    console.log("Mailpit:     http://127.0.0.1:8025");
    console.log("Gallery admin: mise run ops-gallery-bootstrap -- --administrator-user-id <user-id>");
    return;
  }
  if (action === "down") {
    withDockerMutationController(snapshot, "shareslices", ({ runMutation }) => {
      runMutation("docker", dockerArgs, { cwd: repositoryRoot, env: environment, stdio: "inherit" });
    }, { cwd: repositoryRoot, env: environment });
  } else {
    runPinnedReadOnly(snapshot, "docker", dockerArgs, {
      cwd: repositoryRoot,
      env: environment,
      runOptions: { cwd: repositoryRoot, env: environment, stdio: "inherit" },
    });
  }
  if (action === "status") {
    verifyComposeState(snapshot, environment);
    await verifyLocalStack();
  }
}

export function runDeveloperComposeCli() {
  return main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runDeveloperComposeCli();
