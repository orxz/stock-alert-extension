// scripts/validate-manifest.mjs
// Task 20 Step 2 — 消费 extension/manifest.json（源）与 build/extension/manifest.json（构建后）。
// 验证 MV3 字段：background.type=module、精确 permissions/hosts/CSP、入口文件存在。
import { access, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const REQUIRED_HOSTS = [
  'https://hq.sinajs.cn/*',
  'https://push2.eastmoney.com/*',
  'https://searchapi.eastmoney.com/*'
];

const REQUIRED_PERMISSIONS = ['storage', 'alarms'];

const REQUIRED_CSP = "script-src 'self'; object-src 'self'";

/**
 * 验证 manifest 对象。rootDir 是 manifest.json 所在目录（用于解析相对路径）。
 * @param {object} manifest
 * @param {string|URL} rootDir
 * @returns {Promise<string[]>} 错误列表（空表示通过）
 */
export async function validateManifest(manifest, rootDir) {
  const errors = [];
  const root = rootDir instanceof URL ? fileURLToPath(rootDir) : String(rootDir);

  // 1. 基本字段。
  if (manifest.manifest_version !== 3) errors.push('manifest_version must equal 3');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) errors.push('version must use x.y.z');

  // 2. permissions 精确匹配。
  for (const perm of REQUIRED_PERMISSIONS) {
    if (!manifest.permissions?.includes(perm)) {
      errors.push(`permissions must include ${perm}`);
    }
  }

  // 3. host_permissions 精确匹配。
  if (JSON.stringify(manifest.host_permissions || []) !== JSON.stringify(REQUIRED_HOSTS)) {
    errors.push('host_permissions must match the approved three hosts');
  }

  // 4. background 必须是 ES module。
  if (!manifest.background) {
    errors.push('background is required');
  } else {
    if (manifest.background.type !== 'module') {
      errors.push('background.type must equal "module"');
    }
    if (!manifest.background.service_worker) {
      errors.push('background.service_worker is required');
    }
  }

  // 5. CSP 精确匹配。
  if (manifest.content_security_policy?.extension_pages !== REQUIRED_CSP) {
    errors.push('content_security_policy.extension_pages must match the approved CSP');
  }

  // 6. 入口文件存在性检查。runtime/ 路径是 tsc 输出，只在 build/extension/ 中存在；
  //    源验证（extension/）跳过 runtime/ 前缀的入口，仅检查静态资源。
  const allFiles = [
    manifest.action?.default_popup,
    manifest.background?.service_worker,
    ...Object.values(manifest.action?.default_icon || {}),
    ...Object.values(manifest.icons || {})
  ].filter(Boolean);
  const isBuildDir = resolve(root).endsWith(join('build', 'extension'));
  const files = isBuildDir
    ? allFiles
    : allFiles.filter((file) => !file.startsWith('runtime/'));
  for (const file of new Set(files)) {
    try {
      await access(resolve(root, file));
    } catch {
      errors.push(`missing runtime file: ${file}`);
    }
  }

  // 7. 不含 v1 classic-script 引用（importScripts、classic background）。
  const manifestJson = JSON.stringify(manifest);
  if (manifestJson.includes('importScripts')) {
    errors.push('manifest must not reference importScripts (v1 classic script)');
  }

  return errors;
}

// CLI 入口：验证 extension/manifest.json（如果 build/extension/ 存在也验证）。
const entryPath = process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  const repoRoot = resolve(scriptDir, '..');

  const sourceManifestPath = join(repoRoot, 'extension/manifest.json');
  const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
  const sourceErrors = await validateManifest(sourceManifest, join(repoRoot, 'extension'));
  if (sourceErrors.length) {
    console.error('source manifest validation FAILED:');
    for (const e of sourceErrors) console.error(`  ${e}`);
    process.exitCode = 1;
  } else {
    console.log(`source manifest ${sourceManifest.version} is valid`);
  }

  // 如果 build/extension/manifest.json 存在，也验证它。
  const buildManifestPath = join(repoRoot, 'build/extension/manifest.json');
  try {
    await stat(buildManifestPath);
    const buildManifest = JSON.parse(await readFile(buildManifestPath, 'utf8'));
    const buildErrors = await validateManifest(buildManifest, join(repoRoot, 'build/extension'));
    if (buildErrors.length) {
      console.error('build manifest validation FAILED:');
      for (const e of buildErrors) console.error(`  ${e}`);
      process.exitCode = 1;
    } else {
      console.log(`build manifest ${buildManifest.version} is valid`);
    }
  } catch {
    console.log('build manifest not found (run npm run build first) — skipping build validation');
  }
}
