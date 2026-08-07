// scripts/extract-changelog.mjs
// 从 CHANGELOG.md 提取指定版本（如 2.0.1）的段落，输出到 stdout。
// 段落定义为 `## vX.Y.Z` 标题行到下一个 `---` 分隔符（不含）之间的所有行。
// 版本不存在时以非零退出码失败——选择器落空要抛错，不要静默。
//
// CLI: node scripts/extract-changelog.mjs <version>
//   version 不带 v 前缀（如 2.0.1），脚本内部匹配 `## v2.0.1`。
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/**
 * 从 CHANGELOG.md 提取指定版本段落。
 * @param {string} version — 不带 v 前缀的版本号（如 "2.0.1"）
 * @param {string} [changelogPath] — CHANGELOG.md 路径（测试注入）
 * @returns {string} 段落文本（含标题行）
 * @throws {Error} 版本不存在时抛错
 */
export function extractChangelogSection(version, changelogPath) {
  const filePath = changelogPath ?? join(REPO_ROOT, 'CHANGELOG.md');
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // 匹配标题行：## v2.0.1 — ... 或 ## v2.0.1（允许标题后任意文字）
  const headingRe = new RegExp(`^##\\s+v${escapeRegExp(version)}\\b`);
  let startIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) {
    throw new Error(`version section not found in CHANGELOG.md: v${version}`);
  }

  // 从标题行收集到下一个 `---` 分隔符（不含），或文件结尾。
  const collected = [];
  for (let i = startIndex; i < lines.length; i++) {
    if (lines[i].trim() === '---') break;
    collected.push(lines[i]);
  }

  // 去掉末尾空行。
  while (collected.length > 0 && collected[collected.length - 1].trim() === '') {
    collected.pop();
  }

  return collected.join('\n');
}

/** 转义正则特殊字符。 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// CLI 入口。
const entryPath = process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node scripts/extract-changelog.mjs <version>');
    console.error('  version: 不带 v 前缀的版本号（如 2.0.1）');
    process.exit(2);
  }
  try {
    const section = extractChangelogSection(version);
    process.stdout.write(section + '\n');
  } catch (error) {
    console.error(`extract-changelog: ${error.message}`);
    process.exit(1);
  }
}
