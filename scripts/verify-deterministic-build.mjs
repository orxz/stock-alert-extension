// scripts/verify-deterministic-build.mjs
// Task 20 Step 3 — 证明确定性清洁构建。
// 从两个独立的精确临时目录分别构建，比较 ZIP 字节是否完全一致。
// 若哈希不同，打印差异条目名。
import { createHash } from 'node:crypto';
import { mkdtemp, rm, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { unzipSync } from 'fflate';

const exec = promisify(execFile);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/**
 * 在一个精确的临时目录中复制仓库（排除 node_modules/build/dist/.git），
 * 运行 npm ci + npm run build + npm run package:extension，
 * 返回 ZIP 的 SHA-256 和条目列表。
 */
async function buildAndHash(tempDir, label) {
  const src = REPO_ROOT;
  // 复制仓库到临时目录（排除不需要的大目录）。
  await cp(src, tempDir, {
    recursive: true,
    filter: (s) => {
      const rel = s.slice(src.length);
      if (rel === '') return true;
      const segments = rel.split('/').filter(Boolean);
      const excluded = new Set(['node_modules', 'build', 'dist', '.git', 'coverage', 'test-results']);
      return !segments.some((seg) => excluded.has(seg));
    }
  });

  // npm ci（使用已复制的 lockfile）。
  await exec('npm', ['ci'], { cwd: tempDir, timeout: 120000 });

  // 构建 + 打包。
  await exec('node', ['scripts/build-extension.mjs'], { cwd: tempDir, timeout: 60000 });
  await exec('node', ['scripts/package-extension.mjs'], { cwd: tempDir, timeout: 60000 });

  // 读取 ZIP。
  const manifest = JSON.parse(await readFile(join(tempDir, 'extension/manifest.json'), 'utf8'));
  const zipPath = join(tempDir, 'dist', `stock-alert-extension-v${manifest.version}.zip`);
  const archive = new Uint8Array(await readFile(zipPath));
  const hash = createHash('sha256').update(archive).digest('hex');
  const entries = Object.keys(unzipSync(archive)).sort();

  console.log(`[verify-deterministic-build] ${label}: ${hash} (${entries.length} entries)`);
  return { hash, entries, archive };
}

/**
 * 在两个独立临时目录中构建并比较结果。
 * @param {string} [root]
 */
export async function verifyDeterministicBuild(root = REPO_ROOT) {
  void root;
  const tempBase = await mkdtemp(join(os.tmpdir(), 'stock-alert-det-'));

  try {
    const first = await buildAndHash(join(tempBase, 'first'), 'first');
    const second = await buildAndHash(join(tempBase, 'second'), 'second');

    if (first.hash !== second.hash) {
      // 打印差异条目。
      const firstSet = new Set(first.entries);
      const secondSet = new Set(second.entries);
      const onlyFirst = first.entries.filter((e) => !secondSet.has(e));
      const onlySecond = second.entries.filter((e) => !firstSet.has(e));
      const common = first.entries.filter((e) => secondSet.has(e));

      const diffs = [];
      for (const name of onlyFirst) diffs.push(`  only in first:  ${name}`);
      for (const name of onlySecond) diffs.push(`  only in second: ${name}`);

      // 逐条目比较内容哈希。
      const firstDecoded = unzipSync(first.archive);
      const secondDecoded = unzipSync(second.archive);
      for (const name of common) {
        const h1 = createHash('sha256').update(firstDecoded[name]).digest('hex').slice(0, 16);
        const h2 = createHash('sha256').update(secondDecoded[name]).digest('hex').slice(0, 16);
        if (h1 !== h2) diffs.push(`  content differs: ${name} (${h1} != ${h2})`);
      }

      throw new Error(
        `non-deterministic release: ${first.hash} != ${second.hash}\n${diffs.join('\n')}`
      );
    }

    console.log(`[verify-deterministic-build] PASS: both builds identical (${first.hash})`);
    return { hash: first.hash, entries: first.entries };
  } finally {
    await rm(tempBase, { recursive: true, force: true }).catch(() => {});
  }
}

const entryPath = process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  verifyDeterministicBuild().catch((error) => {
    console.error('[verify-deterministic-build] FAILED', error?.stack ?? error);
    process.exit(1);
  });
}
