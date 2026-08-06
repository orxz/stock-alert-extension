// scripts/capture-store-assets.mjs
// Task 20 — v2 商店素材生成脚本。
//
// 从 extension/manifest.json（正式源）读取版本号，构建 build/extension/，
// 加载真实 popup 页面截图，再合成为 Chrome 应用商店要求的画布尺寸。
//
// 商店硬性尺寸（不符会被直接拒绝，错误文案是「图片尺寸不正确」）：
//   截图      1280x800（或 640x400），1–5 张
//   小图块    440x280
//   顶部图块  1400x560
//   格式      JPEG 或 24 位 PNG，**不得带 alpha 透明层**
//
// 为什么要合成而不是直接截 popup：popup 只有 420x560，直接上传尺寸不合规。
// 这里把真实 popup 截图放进品牌背景板再按目标尺寸截取——展示的仍是真实界面，
// 不是手绘 mockup（旧版 promo 就是手绘的，界面与产品对不上还写了不存在的功能）。
//
// alpha：Chromium 对不透明页面导出的 PNG 就是 24 位 RGB（无 alpha），
// 背景板 body 铺满不透明底色即可满足；结尾会逐张校验，不合规直接失败。
//
// 由于 e2e fixture 是 TypeScript，本脚本通过 tsx 运行：
//   npm run capture:store
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** 真实 popup 几何：420x560（见 layout 设计预算 44+38+42+404+32）。 */
const POPUP = { width: 420, height: 560 };

// v2 popup 行情模拟数据（8 只股票，涨跌兼有，覆盖沪深）。
const STOCKS = [
  ['sh600519', '贵州茅台', 1689.0, 0.81, 4.1e9],
  ['sz300418', '昆仑万维', 50.65, 5.61, 1.8e9],
  ['sz300750', '宁德时代', 210.5, 2.68, 2.7e9],
  ['sz002475', '立讯精密', 38.9, 3.73, 6.2e8],
  ['sh601899', '紫金矿业', 14.2, 2.53, 5.1e8],
  ['sh601318', '中国平安', 48.3, 1.05, 8.9e8],
  ['sz000858', '五粮液', 156.2, -1.39, 9.4e8],
  ['sh600036', '招商银行', 35.8, -0.83, 7.3e8]
];

function buildSeed() {
  const BASE = Date.UTC(2026, 6, 31, 6, 32, 0);
  // 行情抓取时间必须相对「现在」，否则素材里每一行都是「已过期」、状态栏读作
  // 「实时 0 / 缓存 8」——产品看起来像取不到数据。fresh 阈值 30s（domain/quote.ts），
  // 这里取 3s 前，稳定落在实时态；排序相关的 addedAt/manualOrder 仍用固定 BASE。
  const FETCHED_AT = Date.now() - 3000;
  const watchlist = STOCKS.map(([code, name], index) => ({
    code,
    name,
    groupIds: ['g_all', 'g_watch'],
    manualOrder: { g_watch: index },
    pinned: {},
    addedAt: BASE - (STOCKS.length - index) * 60_000
  }));
  const cache = Object.fromEntries(
    STOCKS.map(([code, name, price, changePercent, amount], index) => [
      `quoteCache:${code}`,
      {
        cacheVersion: 1,
        code,
        provider: 'eastmoney',
        fetchedAt: FETCHED_AT + index * 10,
        quote: { price, changePercent, amount, change: +((price * changePercent) / 100).toFixed(2) }
      }
    ])
  );
  return {
    schemaVersion: 2,
    groups: [
      { groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: BASE, updatedAt: BASE },
      { groupId: 'g_watch', name: '关注', order: 1, isDefault: false, createdAt: BASE, updatedAt: BASE }
    ],
    watchlist,
    boardConfig: {
      g_all: { viewMode: 'list', sortField: 'manual' },
      g_watch: { viewMode: 'list', sortField: 'manual' }
    },
    ...cache
  };
}

/** 三张截图各自的界面状态与配套文案（文案只描述真实存在的功能）。 */
const SHOTS = [
  {
    key: 'list',
    file: 'screenshot1-list.png',
    preAction: null,
    title: '一屏看完全部自选股',
    lead: '列表视图按分组展示行情，涨跌幅带幅度条，数字等宽对齐便于纵向扫描。',
    bullets: ['实时 / 缓存 / 缺失三态如实标注', '涨红跌绿，界面其余部分不用彩色', '成交额、代码与行情状态一并呈现']
  },
  {
    key: 'grid',
    file: 'screenshot2-grid.png',
    preAction: 'toggleGrid',
    title: '网格卡片，换个密度看',
    lead: '同一份数据的另一种排布，卡片视图同样跟随列设置显隐字段。',
    bullets: ['列表 / 网格一键切换并记住选择', '支持按涨跌幅、价格、成交额排序', '置顶与拖拽排序保留在两种视图']
  },
  {
    key: 'add',
    file: 'screenshot3-add.png',
    preAction: 'openAddDialog',
    title: '代码、拼音、中文都能搜',
    lead: '搜索联想补全，接口不可用时自动降级为本地匹配，不会卡住添加流程。',
    bullets: ['沪深主板 / 科创板 / 创业板 / 北交所', '完整键盘操作，焦点可预期', '自选股与分组仅保存在本地浏览器']
  }
];

/** 宣传图块的功能标签——逐条对应源码中真实存在的能力。 */
const FEATURE_CHIPS = ['分组看板', '实时行情', '列表 · 网格', '列设置', '价格隐藏'];

const TAGLINE = '自选股分组 · 实时行情看板 · 数据仅存本地';

/** 背景板与文字样式：取自 popup 的设计令牌，保证素材与产品同源。 */
const STAGE_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    background: #080b11;
    color: #e8ecf3;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
      "Microsoft YaHei", "Source Han Sans SC", sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }
  .stage {
    position: relative; width: 100%; height: 100%; display: flex; align-items: center;
    background:
      radial-gradient(120% 90% at 12% 0%, #16203040 0%, #0000 60%),
      radial-gradient(90% 80% at 100% 100%, #1b243350 0%, #0000 55%),
      #080b11;
    overflow: hidden;
  }
  /* 极淡的网格底纹：提供质感又不与界面抢注意力。 */
  .stage::before {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background-image:
      linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(80% 70% at 30% 40%, #000 0%, transparent 78%);
  }
  .copy { position: relative; z-index: 1; }
  .eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 15px; letter-spacing: .14em; color: #808ca3; text-transform: uppercase;
  }
  .eyebrow .dot { width: 7px; height: 7px; border-radius: 50%; background: #ff5a5c; }
  h1 { font-size: 46px; line-height: 1.18; font-weight: 700; letter-spacing: -.01em; }
  .lead { font-size: 20px; line-height: 1.62; color: #93a0b5; font-weight: 400; }
  ul { list-style: none; display: flex; flex-direction: column; gap: 13px; }
  li { position: relative; padding-left: 26px; font-size: 17px; line-height: 1.5; color: #93a0b5; }
  li::before {
    content: ''; position: absolute; left: 2px; top: 9px;
    width: 9px; height: 9px; border-radius: 2px;
    background: #16c79a; box-shadow: 0 0 0 3px rgba(22,199,154,0.16);
  }
  .shot {
    position: relative; z-index: 1; flex-shrink: 0; border-radius: 14px; overflow: hidden;
    border: 1px solid rgba(255,255,255,0.14);
    box-shadow: 0 32px 70px rgba(0,0,0,0.6), 0 6px 18px rgba(0,0,0,0.45);
  }
  .shot img { display: block; }
  /* 宣传图块 */
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand img { width: 64px; height: 64px; border-radius: 15px; display: block; }
  .brand .name { font-size: 40px; font-weight: 700; letter-spacing: -.01em; }
  .chips { display: flex; flex-wrap: wrap; gap: 10px; }
  .chip {
    font-size: 16px; color: #93a0b5; padding: 8px 15px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.03);
  }
`;

/** 截图页：左文案 + 右真实界面。 */
function screenshotStage(shot, popupDataUri, scale) {
  const bullets = shot.bullets.map((b) => `<li>${b}</li>`).join('');
  return `<div class="stage" style="padding: 0 76px; gap: 64px;">
    <div class="copy" style="flex:1; display:flex; flex-direction:column; gap:26px; max-width:560px;">
      <span class="eyebrow"><span class="dot"></span>股票提醒助手</span>
      <h1>${shot.title}</h1>
      <p class="lead">${shot.lead}</p>
      <ul>${bullets}</ul>
    </div>
    <div class="shot" style="width:${Math.round(POPUP.width * scale)}px; height:${Math.round(POPUP.height * scale)}px;">
      <img src="${popupDataUri}" width="${Math.round(POPUP.width * scale)}" height="${Math.round(POPUP.height * scale)}" alt="">
    </div>
  </div>`;
}

/** 顶部大图块 1400x560：品牌 + 标签 + 真实界面。 */
function marqueeStage(popupDataUri, iconDataUri, scale) {
  const chips = FEATURE_CHIPS.map((c) => `<span class="chip">${c}</span>`).join('');
  return `<div class="stage" style="padding: 0 84px; gap: 70px;">
    <div class="copy" style="flex:1; display:flex; flex-direction:column; gap:26px; max-width:640px;">
      <div class="brand">
        <img src="${iconDataUri}" alt="">
        <span class="name">股票提醒助手</span>
      </div>
      <p class="lead" style="font-size:22px;">${TAGLINE}</p>
      <div class="chips">${chips}</div>
    </div>
    <div class="shot" style="width:${Math.round(POPUP.width * scale)}px; height:${Math.round(POPUP.height * scale)}px;">
      <img src="${popupDataUri}" width="${Math.round(POPUP.width * scale)}" height="${Math.round(POPUP.height * scale)}" alt="">
    </div>
  </div>`;
}

/** 小图块 440x280：只放品牌与一句话——这个尺寸放界面必然糊。 */
function smallTileStage(iconDataUri) {
  return `<div class="stage" style="padding: 0 34px;">
    <div class="copy" style="display:flex; flex-direction:column; gap:18px;">
      <div class="brand" style="gap:14px;">
        <img src="${iconDataUri}" style="width:52px;height:52px;border-radius:12px;" alt="">
        <span class="name" style="font-size:29px;">股票提醒助手</span>
      </div>
      <p class="lead" style="font-size:16px; line-height:1.55;">A 股自选股分组<br>与实时行情看板</p>
      <span class="eyebrow" style="font-size:13px; letter-spacing:.1em;">
        <span class="dot"></span>数据仅存本地
      </span>
    </div>
  </div>`;
}

/** 校验产物尺寸与色彩类型——不合规立即失败，别等商店拒了才发现。 */
function assertPng(buffer, name, width, height) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error(`${name}: 不是 PNG`);
  const w = buffer.readUInt32BE(16);
  const h = buffer.readUInt32BE(20);
  const bitDepth = buffer.readUInt8(24);
  const colorType = buffer.readUInt8(25);
  if (w !== width || h !== height) {
    throw new Error(`${name}: 尺寸 ${w}x${h}，应为 ${width}x${height}`);
  }
  // colorType 2 = truecolour(RGB, 24 位)；6 = RGBA（带 alpha，商店不接受）。
  if (colorType !== 2 || bitDepth !== 8) {
    throw new Error(`${name}: 需要 24 位无 alpha PNG，实际 bitDepth=${bitDepth} colorType=${colorType}`);
  }
  return `${w}x${h} 24bit`;
}

async function main() {
  const manifest = JSON.parse(await readFile(join(ROOT, 'extension/manifest.json'), 'utf8'));
  const iconDataUri =
    'data:image/png;base64,' +
    (await readFile(join(ROOT, 'store-assets/store-icon-128.png'))).toString('base64');

  const { launchBuiltExtension } = await import('../tests/e2e/extension-fixture.ts');
  const { context, page, extensionId } = await launchBuiltExtension({ offline: true, seed: buildSeed() });

  const results = [];
  try {
    await page.setViewportSize(POPUP);
    await page.waitForSelector('stock-app', { timeout: 10_000 });
    await page.waitForTimeout(800);
    // 关闭过渡/动画，保证像素确定（确定性素材便于 review diff）。
    await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });

    // 1) 先取三张真实 popup 截图（内存中，不落盘）。
    const popupShots = {};
    for (const shot of SHOTS) {
      if (shot.preAction === 'toggleGrid') {
        await page.locator('[data-action="view-grid"]').first().click().catch(() => {});
      }
      if (shot.preAction === 'openAddDialog') {
        await page.locator('[data-action="add-stock"]').first().click().catch(() => {});
      }
      await page.waitForTimeout(350);
      popupShots[shot.key] =
        'data:image/png;base64,' + (await page.screenshot()).toString('base64');
    }

    // 2) 合成到商店画布。stage 页不需要扩展权限，用普通空白页即可。
    const stage = await context.newPage();
    const render = async (html, width, height, outFile) => {
      await stage.setViewportSize({ width, height });
      await stage.setContent(`<style>${STAGE_CSS}</style>${html}`, { waitUntil: 'load' });
      await stage.waitForTimeout(150);
      const buf = await stage.screenshot({ type: 'png' });
      const info = assertPng(buf, outFile, width, height);
      await writeFile(join(ROOT, 'store-assets', outFile), buf);
      results.push(`${outFile.padEnd(24)} ${info}`);
    };

    // 截图 1280x800：popup 放大到 700px 高（420x560 → 525x700）。
    const shotScale = 700 / POPUP.height;
    for (const shot of SHOTS) {
      await render(screenshotStage(shot, popupShots[shot.key], shotScale), 1280, 800, shot.file);
    }
    // 顶部图块 1400x560：popup 高 470px。
    await render(marqueeStage(popupShots.list, iconDataUri, 470 / POPUP.height), 1400, 560, 'promo-large.png');
    // 小图块 440x280。
    await render(smallTileStage(iconDataUri), 440, 280, 'promo-small.png');

    console.log(results.join('\n'));
    console.log(`capture verified: v${manifest.version}, extension ${extensionId}`);
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error('capture-store-assets failed:', error.message);
  process.exit(1);
});
