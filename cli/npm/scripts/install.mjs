import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const repository = 'walnut1024/ShareSlices';

function targetFor(platform, architecture) {
  const targets = {
    'darwin-arm64': { release: 'aarch64-apple-darwin', archive: 'tar.gz' },
    'darwin-x64': { release: 'x86_64-apple-darwin', archive: 'tar.gz' },
    'linux-x64': { release: 'x86_64-unknown-linux-gnu', archive: 'tar.gz' },
    'win32-x64': { release: 'x86_64-pc-windows-msvc', archive: 'zip' },
  };
  const target = targets[`${platform}-${architecture}`];
  if (!target) {
    throw new Error(`Unsupported platform: ${platform}-${architecture}`);
  }
  return target;
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

function checksumFor(checksums, archive) {
  for (const line of checksums.trim().split('\n')) {
    const [checksum, filename] = line.trim().split(/\s+/);
    if (filename === archive) {
      return checksum;
    }
  }
  throw new Error(`No checksum was published for ${archive}.`);
}

function extract(archivePath, destination, archiveType) {
  const command = archiveType === 'zip' ? 'powershell.exe' : 'tar';
  const args = archiveType === 'zip'
    ? ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`]
    : ['-xzf', archivePath, '-C', destination];
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to extract ${archivePath}.`);
  }
}

async function main() {
  const target = targetFor(process.platform, process.arch);
  const archive = `shareslices-${target.release}.${target.archive}`;
  const releaseBase = process.env.SHARESLICES_RELEASE_BASE_URL?.replace(/\/$/, '')
    ?? `https://github.com/${repository}/releases/download/cli-v${packageManifest.version}`;
  const temporaryDirectory = join(packageRoot, '.download');
  const archivePath = join(temporaryDirectory, archive);
  const checksumsPath = join(temporaryDirectory, 'SHA256SUMS');
  const destination = join(packageRoot, 'bin', `${process.platform}-${process.arch}`);

  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: true });
  try {
    await Promise.all([
      download(`${releaseBase}/${archive}`, archivePath),
      download(`${releaseBase}/SHA256SUMS`, checksumsPath),
    ]);
    const expectedChecksum = checksumFor(await readFile(checksumsPath, 'utf8'), archive);
    const actualChecksum = createHash('sha256').update(await readFile(archivePath)).digest('hex');
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`Checksum verification failed for ${archive}.`);
    }

    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    extract(archivePath, destination, target.archive);
    const executable = join(destination, process.platform === 'win32' ? 'shareslices.exe' : 'shareslices');
    if (!existsSync(executable)) {
      throw new Error(`The archive did not contain ${executable}.`);
    }
    if (process.platform !== 'win32') {
      await chmod(executable, 0o755);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await main();
