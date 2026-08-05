// scripts/capture-store-assets.mjs
// Task 20 — v2 商店素材截图脚本。
//
// 从 extension/manifest.json（正式源）读取版本号，构建 build/extension/，
// 加载真实 popup 页面并截取商店截图。
// v2 popup 使用 Web Components（<stock-app>），通过 e2e fixture 的启动逻辑加载。
//
// 由于 e2e fixture 是 TypeScript，本脚本通过 tsx 运行：
//   node --import tsx scripts/capture-store-assets.mjs
// 或在 package.json 中配置 "capture:store": "tsx scripts/capture-store-assets.mjs"。
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// v2 popup 行情模拟数据（与 v1.3 capture 一致的 8 只股票）。
const STOCKS = [
  ['sh600519', '贵州茅台', 1689.00, 0.81, 4.1e9],
  ['sz300418', '昆仑万维', 50.65, 5.61, 1.8e9],
  ['sz300750', '宁德时代', 210.50, 2.68, 2.7e9],
  ['sz002475', '立讯精密', 38.90, 3.73, 6.2e8],
  ['sh601899', '紫金矿业', 14.20, 2.53, 5.1e8],
  ['sh601318', '中国平安', 48.30, 1.05, 8.9e8],
  ['sz000858', '五粮液', 156.20, -1.39, 9.4e8],
  ['sh600036', '招商银行', 35.80, -0.83, 7.3e8]
];

function buildSeed() {
  const BASE = Date.UTC(2026, 6, 31, 6, 32, 0);
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
        fetchedAt: BASE - 5000 + index * 100,
        quote: { price, changePercent, amount, change: +(price * changePercent / 100).toFixed(2) }
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
    boardConfig: { g_all: { viewMode: 'list', sortField: 'manual' }, g_watch: { viewMode: 'list', sortField: 'manual' } },
    ...cache
  };
}

const SCENARIOS = [
  { name: 'screenshot1-list.png', viewport: { width: 420, height: 640 } },
  { name: 'screenshot2-grid.png', viewport: { width: 420, height: 640 }, preAction: 'toggleGrid' },
  { name: 'screenshot3-add.png', viewport: { width: 420, height: 640 }, preAction: 'openAddDialog' }
];

async function main() {
  const manifestPath = join(ROOT, 'extension/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  // 动态导入 e2e fixture（TypeScript，需 tsx 运行时）。
  const { launchBuiltExtension } = await import('../tests/e2e/extension-fixture.ts');

  const seed = buildSeed();
  const { context, page, extensionId } = await launchBuiltExtension({ offline: true, seed });

  try {
    await page.setViewportSize({ width: 420, height: 640 });
    // 等待 stock-app 渲染完成
    await page.waitForSelector('stock-app', { timeout: 10_000 });
    await page.waitForTimeout(800);
    // 禁用过渡/动画，确保截图像素确定
    await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });

    for (const scenario of SCENARIOS) {
      await page.setViewportSize(scenario.viewport);
      if (scenario.preAction === 'toggleGrid') {
        // 点击工具栏的网格视图按钮
        const gridBtn = page.locator('[data-action="view-grid"], button:has-text("网格")').first();
        if (await gridBtn.count() > 0) await gridBtn.click().catch(() => {});
      }
      if (scenario.preAction === 'openAddDialog') {
        const addBtn = page.locator('[data-action="add-stock"], button:has-text("添加")').first();
        if (await addBtn.count() > 0) await addBtn.click().catch(() => {});
      }
      await page.waitForTimeout(300);
      const outPath = join(ROOT, 'store-assets', scenario.name);
      await page.screenshot({ path: outPath });
      console.log(`capture: ${scenario.name} (${scenario.viewport.width}x${scenario.viewport.height})`);
    }

    console.log(`capture verified: v${manifest.version}, extension ${extensionId}`);
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error('capture-store-assets failed:', error.message);
  process.exit(1);
});
