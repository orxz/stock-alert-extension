// tests/unit/build/store-assets.test.mjs
// Chrome 应用商店素材的硬性规格断言。
//
// 为什么要有这条门禁：商店对尺寸和色彩类型是硬拒的，错误只在**上传那一刻**才出现
// （文案就一句「图片尺寸不正确」），而素材是脚本生成、随版本一起提交的——
// 生成脚本改错了尺寸，仓库里躺着的就是一批不能用的素材，直到发版当天才发现。
// 这里直接读 PNG 头校验，无需浏览器，进 ci。
//
// 规格来源：Chrome Web Store 开发者后台
//   截图      1280x800 或 640x400，1–5 张
//   小图块    440x280
//   顶部图块  1400x560
//   格式      JPEG 或 24 位 PNG，不得带 alpha 透明层
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const DIR = join(REPO_ROOT, 'store-assets');

/** 读 PNG IHDR：宽、高、位深、色彩类型。 */
function readPng(file) {
  const buf = readFileSync(join(DIR, file));
  assert.equal(buf.readUInt32BE(0), 0x89504e47, `${file}: 不是 PNG`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf.readUInt8(24),
    colorType: buf.readUInt8(25)
  };
}

/** 允许的截图画布（商店只接受这两种）。 */
const SCREENSHOT_SIZES = [
  [1280, 800],
  [640, 400]
];

const TILES = {
  'promo-small.png': [440, 280],
  'promo-large.png': [1400, 560]
};

function screenshotFiles() {
  return readdirSync(DIR).filter((f) => /^screenshot.*\.png$/.test(f)).sort();
}

test('screenshots use an accepted store canvas size', () => {
  const files = screenshotFiles();
  assert.ok(files.length >= 1, '至少要有 1 张截图');
  assert.ok(files.length <= 5, `最多 5 张截图，实际 ${files.length}`);
  for (const file of files) {
    const { width, height } = readPng(file);
    const ok = SCREENSHOT_SIZES.some(([w, h]) => w === width && h === height);
    assert.ok(ok, `${file}: ${width}x${height} 不是 1280x800 或 640x400`);
  }
});

test('promo tiles match the exact tile canvas', () => {
  for (const [file, [w, h]] of Object.entries(TILES)) {
    const { width, height } = readPng(file);
    assert.equal(width, w, `${file}: 宽应为 ${w}`);
    assert.equal(height, h, `${file}: 高应为 ${h}`);
  }
});

test('store images are 24-bit PNG without an alpha channel', () => {
  // colorType 2 = truecolour（RGB，24 位）。6 = RGBA、4 = 灰度+alpha，商店都不接受。
  // 图标 store-icon-128.png 不在此列——它是扩展图标，允许透明。
  for (const file of [...screenshotFiles(), ...Object.keys(TILES)]) {
    const { bitDepth, colorType } = readPng(file);
    assert.equal(colorType, 2, `${file}: colorType=${colorType}，需要 2（RGB 无 alpha）`);
    assert.equal(bitDepth, 8, `${file}: bitDepth=${bitDepth}，需要 8`);
  }
});
