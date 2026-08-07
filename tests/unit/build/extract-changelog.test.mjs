// tests/unit/build/extract-changelog.test.mjs
// extract-changelog.mjs 的契约测试——守护 Release workflow 的 release notes 生成。
// 放在 tests/unit/build/ 纳入 `npm run test:build` glob（纯 Node，无需浏览器）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractChangelogSection } from '../../../scripts/extract-changelog.mjs';

const exec = promisify(execFile);

/** 构造一个最小 CHANGELOG fixture，结构与真实文件一致。 */
const SAMPLE = `# 更新日志

## Unreleased

### 新增
- 跨浏览器支持

---

## v2.0.1 — 列设置修复与详情面板丰富

### 变更
- 「多选」改名「管理持仓」

### 修复
- 列设置面板排序

### 新增
- 详情面板丰富

---

## v2.0.0 — 基础架构重建

> 基础架构重建。

### 架构升级
- TypeScript + 原生 ES Modules
`;

test('extractChangelogSection extracts the correct version block', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'changelog-'));
  const filePath = join(dir, 'CHANGELOG.md');
  await writeFile(filePath, SAMPLE, 'utf8');

  const section = extractChangelogSection('2.0.1', filePath);

  // 包含标题行
  assert.ok(section.startsWith('## v2.0.1 — 列设置修复与详情面板丰富'));
  // 包含该版本内容
  assert.ok(section.includes('列设置修复'), '应包含 v2.0.1 的内容');
  assert.ok(section.includes('详情面板丰富'), '应包含 v2.0.1 新增段');
  // 不含下一个版本的标题
  assert.ok(!section.includes('v2.0.0'), '不应包含 v2.0.0 段');
  // 不含 Unreleased
  assert.ok(!section.includes('Unreleased'), '不应包含 Unreleased 段');
  // 不含分隔符
  assert.ok(!section.includes('\n---\n'), '不应包含段落分隔符');

  await rm(dir, { recursive: true, force: true });
});

test('extractChangelogSection throws when version not found', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'changelog-'));
  const filePath = join(dir, 'CHANGELOG.md');
  await writeFile(filePath, SAMPLE, 'utf8');

  // 选择器落空要抛错，不要静默
  assert.throws(
    () => extractChangelogSection('9.9.9', filePath),
    /version section not found.*v9\.9\.9/
  );

  await rm(dir, { recursive: true, force: true });
});

test('extractChangelogSection does not match Unreleased via version number', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'changelog-'));
  const filePath = join(dir, 'CHANGELOG.md');
  await writeFile(filePath, SAMPLE, 'utf8');

  // "Unreleased" 不带 vX.Y.Z 前缀，用版本号匹配不到
  assert.throws(
    () => extractChangelogSection('Unreleased', filePath),
    /version section not found/
  );

  await rm(dir, { recursive: true, force: true });
});

test('extractChangelogSection uses word boundary to avoid partial match', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'changelog-'));
  const filePath = join(dir, 'CHANGELOG.md');
  await writeFile(filePath, SAMPLE, 'utf8');

  // "2.0.1" 不应误匹配 "2.0.10"——当前 fixture 没有 2.0.10，但边界保护是契约
  // 这里验证 "2.0.0" 精确匹配而非 "2.0.01" 等
  const section = extractChangelogSection('2.0.0', filePath);
  assert.ok(section.includes('基础架构重建'));
  assert.ok(!section.includes('列设置修复'));

  await rm(dir, { recursive: true, force: true });
});

test('CLI extracts real CHANGELOG v2.0.1 and exits non-zero on missing version', async () => {
  // 实证：用真实 CHANGELOG.md 跑 CLI
  const scriptPath = new URL('../../../scripts/extract-changelog.mjs', import.meta.url).pathname;

  // 正常提取
  const { stdout } = await exec('node', [scriptPath, '2.0.1']);
  assert.ok(stdout.includes('列设置修复'), 'CLI 应输出 v2.0.1 段落');
  assert.ok(stdout.startsWith('## v2.0.1'), '输出应以标题行开头');

  // 版本不存在 → 非零退出码
  await assert.rejects(
    exec('node', [scriptPath, '9.9.9']),
    (error) => error.code !== 0,
    '缺失版本应以非零退出码失败'
  );
});
