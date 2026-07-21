import { fileURLToPath, pathToFileURL } from "node:url";

import { developerComposeArgs, repositoryRoot } from "./developer.mjs";
import {
  dockerEnvironment,
  resolveDockerSnapshot,
  withDockerMutationController,
} from "./docker-controller.mjs";

const operations = Object.freeze({
  "requeue-failed-thumbnails": [
    ...developerComposeArgs,
    "run",
    "--rm",
    "--no-deps",
    "worker",
    "requeue-failed-thumbnails",
  ],
});

export function runWorkerOperation(operation) {
  const composeArgs = operations[operation];
  if (!composeArgs) throw new Error(`Unknown local worker operation: ${operation}`);
  const snapshot = resolveDockerSnapshot({ workingDirectory: repositoryRoot });
  const environment = dockerEnvironment(snapshot);
  withDockerMutationController(snapshot, "shareslices", ({ runMutation }) => {
    runMutation(
      "docker",
      [...snapshot.connectionArgs, ...composeArgs],
      { cwd: repositoryRoot, env: environment, stdio: "inherit" },
    );
  }, { cwd: repositoryRoot, env: environment });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runWorkerOperation(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
