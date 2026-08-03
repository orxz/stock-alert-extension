import { cp, lstat, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);

async function assertDedicatedBuildPath(root, buildRoot) {
  const rootPath = resolve(fileURLToPath(root));
  const buildPath = resolve(fileURLToPath(buildRoot));
  if (buildPath !== join(rootPath, 'build') || buildPath === rootPath || buildPath === resolve('/')) {
    throw new Error(`refusing unsafe build path: ${buildPath}`);
  }
  try {
    if ((await lstat(buildPath)).isSymbolicLink()) throw new Error(`refusing symlink build path: ${buildPath}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function buildExtension(root = new URL('../', import.meta.url)) {
  const buildRoot = new URL('build/', root);
  const build = new URL('build/extension/', root);
  await assertDedicatedBuildPath(root, buildRoot);
  await rm(buildRoot, { recursive: true, force: true });
  await mkdir(build, { recursive: true });
  await cp(new URL('extension/', root), build, { recursive: true });
  await exec('node_modules/.bin/tsc', ['--build', 'tsconfig.json'], { cwd: new URL('.', root) });
  return build;
}
