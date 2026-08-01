import { copyFile, readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { launchExtension } from '../tests/e2e/extension-fixture.mjs';

/** @type {Array<[string, string, number, number]>} */
const STOCKS = [
  ['sh600519', '贵州茅台', 1689.00, 0.81],
  ['sz300418', '昆仑万维', 50.65, 5.61],
  ['sz300750', '宁德时代', 210.50, 2.68],
  ['sz002475', '立讯精密', 38.90, 3.73],
  ['sh601899', '紫金矿业', 14.20, 2.53],
  ['sh601318', '中国平安', 48.30, 1.05],
  ['sz000858', '五粮液', 156.20, -1.39],
  ['sh600036', '招商银行', 35.80, -0.83]
];

function buildSeed() {
  const realNow = Date.now();
  const BASE = Date.UTC(2026, 6, 31, 6, 32, 0);
  const watchlist = STOCKS.map(([code, name], index) => ({
    code,
    name,
    groupIds: index < 4 ? ['g_tech'] : [],
    manualOrder: { g_all: index },
    pinned: index === 0 ? { g_all: true } : {},
    addedAt: BASE - index * 1000
  }));
  const cache = Object.fromEntries(STOCKS.map(([code, name, price, changePercent], index) => [
    `quoteCache:${code}`,
    {
      cacheVersion: 1,
      code,
      provider: 'eastmoney',
      fetchedAt: index === 7 ? BASE : realNow - 1000,
      quote: {
        name,
        price,
        prevClose: price / (1 + changePercent / 100),
        open: price,
        high: price,
        low: price,
        volume: 100000,
        amount: 1000000,
        change: price - price / (1 + changePercent / 100),
        changePercent
      }
    }
  ]));
  return {
    schemaVersion: 2,
    groups: [
      { groupId: 'g_all', name: '全部', order: 0, isDefault: true },
      { groupId: 'g_tech', name: '科技', order: 1, isDefault: false }
    ],
    watchlist,
    boardConfig: {},
    ...cache
  };
}

async function renderMarketingCanvas(page, { title, subtitle, popupPng, output }) {
  const image = `data:image/png;base64,${popupPng.toString('base64')}`;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; width: 1280px; height: 800px; background: #0F1723; color: #F8FAFC; font-family: -apple-system, "PingFang SC", sans-serif; }
      main { display: grid; grid-template-columns: 1fr 520px; align-items: center; width: 100%; height: 100%; padding: 60px; }
      h1 { margin: 0 0 18px; font-size: 52px; }
      p { margin: 0; color: #A8B3C5; font-size: 22px; }
      img { width: 420px; justify-self: center; border-radius: 12px; box-shadow: 0 24px 70px rgba(0,0,0,.45); }
    </style>
    <main><section><h1>${title}</h1><p>${subtitle}</p></section><img src="${image}" alt=""></main>
  `);
  await page.screenshot({ path: output });
}

const scenarios = [
  { file: 'screenshot1-list.png', title: '列表视图', subtitle: '实时、缓存和缺失状态一眼可辨', prepare: (page) => page.click('#btn-view-list') },
  { file: 'screenshot2-grid.png', title: '网格视图', subtitle: '分组看板与可信行情状态', prepare: (page) => page.click('#btn-view-grid') },
  { file: 'screenshot3-add.png', title: '添加自选股', subtitle: '加入任意分组，始终出现在全部视图', prepare: (page) => page.click('#btn-add-stock') }
];

// v1.3.0 起 QuoteService 常驻 Service Worker，其退避状态会跨 Popup 重载存活。
// 因此必须先播种再首屏加载（单次加载），避免「空自选股首屏 → refresh → 进入退避」
// 使重载后的刷新走退避分支、把全部缓存判为过期。与 e2e mixed-cache 用例一致。
const { context, page, worker, releaseHold } = await launchExtension({ offline: true, holdQuotes: true, seed: buildSeed() });
const marketingPage = await context.newPage();
await page.setViewportSize({ width: 420, height: 640 });
await expect(page.locator('#quote-status-summary')).toHaveText('实时 7 · 缓存 1');
await expect(page.locator('.quote-stale')).toHaveCount(1);
await expect(page.locator('#update-time')).toHaveText('未更新');
await page.waitForTimeout(500);
// 禁用过渡/动画，避免截图捕获弹窗淡入等动画的中间帧导致像素不确定
await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
const version = await page.locator('#brand-version').textContent();
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
if (version !== manifest.version) throw new Error(`expected popup version ${manifest.version}, got ${version}`);
const summary = await page.locator('#quote-status-summary').textContent();
if (summary !== '实时 7 · 缓存 1') throw new Error(`expected mixed summary, got ${summary}`);
console.log(`capture verified: v${version}, ${summary}`);
for (const scenario of scenarios) {
  await scenario.prepare(page);
  await expect(page.locator('#quote-status-summary')).toHaveText('实时 7 · 缓存 1');
  await page.waitForTimeout(300);
  const popupPng = await page.screenshot({ type: 'png' });
  const storePath = `store-assets/${scenario.file}`;
  await renderMarketingCanvas(marketingPage, { ...scenario, popupPng, output: storePath });
  await copyFile(storePath, `docs/screenshots/${scenario.file}`);
}
releaseHold?.();
await context.close();
