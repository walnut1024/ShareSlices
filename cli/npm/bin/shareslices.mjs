#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const executable = join(
  packageRoot,
  'bin',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'shareslices.exe' : 'shareslices',
);

if (!existsSync(executable)) {
  console.error('ShareSlices CLI is missing. Reinstall @shareslices/cli without --ignore-scripts.');
  process.exitCode = 1;
} else {
  const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit' });
  if (result.error) {
    console.error(`Unable to run ShareSlices CLI: ${result.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
