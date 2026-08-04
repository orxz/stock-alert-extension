// scripts/package-extension.mjs
// Task 20 Step 2 — 从正式构建产物 build/extension/ 打包。
// 递归枚举 build 目录（词典序），拒绝符号链接和禁止后缀，分配固定 DOS 时间戳。
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative } from 'node:path';
import { zipSync } from 'fflate';

// 禁止的文件后缀（不允许出现在正式包中）。
const FORBIDDEN_SUFFIXES = ['.ts', '.map', '.mjs', '.md', '.txt', '.test.js'];

// 禁止的根级 v1 文件。
const FORBIDDEN_FILES = new Set([
  'background.js', 'popup-actions.js', 'popup-bridge.js', 'popup-render.js',
  'popup-state.js', 'popup.js', 'quote-format.js', 'quote-service.js',
  'quotes.js', 'router.js', 'stock-utils.js', 'storage.js', 'popup.css'
]);

// 固定 1980-01-01 00:00:00（无时区后缀，确保跨 CI/本地一致性）。
const FIXED_MTIME = new Date('1980-01-01T00:00:00');

/** 递归枚举目录中的文件（词典序，返回相对路径）。 */
async function listFiles(dir, base = dir) {
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(base, fullPath).split('\\').join('/');
    if (entry.isDirectory()) {
      results.push(...await listFiles(fullPath, base));
    } else if (entry.isFile()) {
      // 拒绝符号链接。
      const info = await lstat(fullPath);
      if (info.isSymbolicLink()) {
        throw new Error(`refusing symlink in build output: ${relPath}`);
      }
      results.push(relPath);
    }
  }
  return results;
}

/** 验证文件路径是否符合允许列表规则。 */
function validateEntry(relPath) {
  // 1. 禁止后缀。
  for (const suffix of FORBIDDEN_SUFFIXES) {
    if (relPath.endsWith(suffix)) {
      throw new Error(`forbidden suffix in build output: ${relPath}`);
    }
  }
  // 2. 禁止 v1 根文件。
  if (FORBIDDEN_FILES.has(relPath)) {
    throw new Error(`forbidden legacy v1 file in build output: ${relPath}`);
  }
  // 3. .js 文件必须在 runtime/ 目录下（或 popup/ 目录，但当前 popup 用 Web Components 无独立 JS）。
  if (relPath.endsWith('.js') && !relPath.startsWith('runtime/')) {
    throw new Error(`unexpected .js outside runtime/: ${relPath}`);
  }
}

/**
 * 从 build/extension/ 构建正式发布 ZIP。
 * 先调用 buildExtension() 确保产物最新，再枚举打包。
 * @param {URL} [rootDir]
 * @returns {Promise<{ outputFile: string; hash: string; entries: string[] }>}
 */
export async function buildRelease(rootDir = new URL('../', import.meta.url)) {
  const root = fileURLToPath(rootDir);
  const buildDir = join(root, 'build/extension');

  // 读取正式 manifest 获取版本号。
  const manifest = JSON.parse(await readFile(join(root, 'extension/manifest.json'), 'utf8'));

  // 递归枚举构建产物。
  const files = await listFiles(buildDir);

  // 验证每个条目。
  for (const file of files) {
    validateEntry(file);
  }

  // 构建 ZIP 条目（固定时间戳）。
  const entries = {};
  for (const file of files) {
    const bytes = new Uint8Array(await readFile(join(buildDir, file)));
    entries[file] = [bytes, { mtime: FIXED_MTIME }];
  }

  const archive = zipSync(entries, { level: 9 });
  const outputDir = join(root, 'dist');
  const outputFile = join(outputDir, `stock-alert-extension-v${manifest.version}.zip`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputFile, archive);
  const hash = createHash('sha256').update(archive).digest('hex');
  return { outputFile, hash, entries: files };
}

const entryPath = process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  // 先构建，再打包。
  const { buildExtension } = await import('./build-extension.mjs');
  await buildExtension();
  const result = await buildRelease();
  console.log(`${result.hash}  ${result.outputFile}`);
  console.log(`entries: ${result.entries.length} files`);
}
