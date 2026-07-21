#!/usr/bin/env node

import {pathToFileURL} from "node:url";

import {createKubernetesAdapter} from "../kubernetes/adapter.mjs";
import {executeInvocation, parseInvocation} from "./cli.mjs";
import {createLifecycleExecutor} from "./lifecycle.mjs";

export function createProductionExecutor({kubernetesAdapter = createKubernetesAdapter()} = {}) {
  return createLifecycleExecutor({kubernetes: kubernetesAdapter});
}

export async function main(
  argv = process.argv.slice(2),
  output = process.stdout,
  execute = createProductionExecutor(),
) {
  const execution = await executeInvocation(parseInvocation(argv), execute);
  output.write(`${JSON.stringify(execution.result)}\n`);
  return execution.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
