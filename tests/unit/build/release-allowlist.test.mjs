// tests/unit/build/release-allowlist.test.mjs
// Task 20 Step 1 — 释放包允许列表断言。
// 确保正式 ZIP 只包含 build/extension/ 中的构建产物，不含源码、测试、map、文档、v1 运行时。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/** 读取 dist/ 目录下的版本化 ZIP 并返回条目名列表。 */
function listReleaseEntries() {
  // 从 extension/manifest.json 读取版本号（正式 manifest 在 extension/ 目录）。
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'extension/manifest.json'), 'utf8'));
  const zipPath = join(REPO_ROOT, 'dist', `stock-alert-extension-v${manifest.version}.zip`);
  if (!existsSync(zipPath)) {
    throw new Error(`release ZIP not found: ${zipPath} — run npm run package:extension first`);
  }
  const archive = new Uint8Array(readFileSync(zipPath));
  const entries = unzipSync(archive);
  return Object.keys(entries).sort();
}

// 允许的运行时文件后缀（.js 只允许在 runtime/ 目录下）。
const FORBIDDEN_SUFFIXES = ['.ts', '.map', '.mjs', '.json.md', '.test.js'];
const FORBIDDEN_ROOT_FILES = /^(background|storage|router|popup-actions|popup-bridge|popup-render|popup-state|popup|quotes|quote-service|quote-format|stock-utils)\.js$/;

test('release package contains only the formal build artifact', () => {
  const entries = listReleaseEntries();

  // 1. 不含源码文件。
  assert.equal(
    entries.some((name) => name.endsWith('.ts')),
    false,
    'release must not contain .ts source files'
  );

  // 2. 不含 source map。
  assert.equal(
    entries.some((name) => name.endsWith('.map')),
    false,
    'release must not contain .map files'
  );

  // 3. 不含 v1 运行时根文件。
  assert.equal(
    entries.some((name) => FORBIDDEN_ROOT_FILES.test(name)),
    false,
    'release must not contain legacy v1 root runtime files'
  );

  // 4. manifest.json 恰好一份。
  const manifests = entries.filter((name) => name === 'manifest.json');
  assert.deepEqual(manifests, ['manifest.json'], 'release must contain exactly one manifest.json');

  // 5. popup.html 恰好一份。
  const popups = entries.filter((name) => name === 'popup.html');
  assert.deepEqual(popups, ['popup.html'], 'release must contain exactly one popup.html');

  // 6. 不含测试文件。
  assert.equal(
    entries.some((name) => name.includes('test')),
    false,
    'release must not contain test files'
  );

  // 7. 不含文档。
  assert.equal(
    entries.some((name) => name.endsWith('.md') || name.endsWith('.txt')),
    false,
    'release must not contain documentation'
  );

  // 8. 所有 .js 文件必须在 runtime/ 目录下。
  const jsFiles = entries.filter((name) => name.endsWith('.js'));
  for (const js of jsFiles) {
    assert.ok(
      js.startsWith('runtime/'),
      `unexpected .js outside runtime/: ${js}`
    );
  }

  // 9. 不含 lockfile 或 node_modules。
  assert.equal(
    entries.some((name) => name.includes('node_modules') || name.endsWith('package-lock.json')),
    false,
    'release must not contain node_modules or lockfile'
  );

  // 10. background 入口为 module 类型（从 manifest 内容验证）。
  const manifestRaw = strFromU8(
    unzipSync(new Uint8Array(readFileSync(
      join(REPO_ROOT, 'dist', `stock-alert-extension-v${
        JSON.parse(readFileSync(join(REPO_ROOT, 'extension/manifest.json'), 'utf8')).version
      }.zip`)
    )))['manifest.json']
  );
  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.background.type, 'module', 'background must be type: module');
  assert.ok(manifest.background.service_worker.startsWith('runtime/'), 'SW entry must be in runtime/');
});

test('release manifest matches extension/manifest.json source of truth', () => {
  const entries = listReleaseEntries();
  // 重新解压读取 manifest。
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'extension/manifest.json'), 'utf8'));
  const zipPath = join(REPO_ROOT, 'dist', `stock-alert-extension-v${manifest.version}.zip`);
  const archive = new Uint8Array(readFileSync(zipPath));
  const decoded = unzipSync(archive);
  const zipManifest = JSON.parse(strFromU8(decoded['manifest.json']));
  assert.deepEqual(zipManifest, manifest, 'ZIP manifest must match extension/manifest.json');
});
