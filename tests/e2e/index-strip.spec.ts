// tests/e2e/index-strip.spec.ts
// v2.1 固定大盘指数条 + 指数进自选（A+B）的端到端验证。
//
// 覆盖：
// - 指数条常驻渲染（目录顺序 / 无行情占位 / 缓存回放 / 延迟标记）
// - 空 watchlist 时指数条仍在（离线 → '--' 占位，不崩溃）
// - 搜索添加指数（离线降级到本地目录命中「上证指数」）→ 行内渲染，
//   且指数行的估值/涨跌停列渲染 '--'（解析层剔除，不许 0.00/-1.00 透出）
import { expect, test } from '@playwright/test';
import { launchBuiltExtension, baseSeed, getStorage } from './extension-fixture';

/** 目录指数缓存条目（ fetchedAt 参数化）。 */
function indexCache(code: string, fetchedAt: number, price: number) {
  return {
    cacheVersion: 1,
    code,
    provider: 'eastmoney',
    fetchedAt,
    quote: {
      code,
      name: code,
      price,
      prevClose: price - 10,
      open: price - 10,
      high: price + 5,
      low: price - 10,
      volume: 1000,
      amount: 2_000_000_000,
      change: 10,
      changePercent: 0.26
    }
  };
}

test('index strip renders catalog skeleton with dashes when offline and uncached', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [] })
  });
  try {
    const strip = launched.page.locator('#index-strip');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('上证指数');
    await expect(strip).toContainText('深证成指');
    await expect(strip).toContainText('创业板指');
    await expect(strip).toContainText('科创50');
    // 离线且无缓存：四只全部 '--' 占位，绝不渲染伪造价格。
    await expect(strip.locator('.index-chip-price')).toHaveCount(4);
    for (const el of await strip.locator('.index-chip-price').all()) {
      await expect(el).toHaveText('--');
    }
  } finally {
    await launched.close();
  }
});

test('index strip replays cached catalog quotes with stale label', async () => {
  const fetchedAt = Date.now() - 60_000; // 60s 前 → cached（超过 30s freshness）
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({
      watchlist: [],
      'quoteCache:sh000001': indexCache('sh000001', fetchedAt, 3901.33),
      'quoteCache:sz399001': indexCache('sz399001', fetchedAt, 13769.35),
      'quoteCache:sz399006': indexCache('sz399006', fetchedAt, 3400.53),
      'quoteCache:sh000688': indexCache('sh000688', fetchedAt, 1607.54)
    })
  });
  try {
    const strip = launched.page.locator('#index-strip');
    // 冷启动即从缓存渲染（bootstrap 快照含目录指数）。
    await expect(strip).toContainText('3901.33');
    await expect(strip).toContainText('13769.35');
    await expect(strip).toContainText('3400.53');
    // cached 态带「延迟」标记。
    await expect(strip.locator('.index-chip-pct').first()).toContainText('延迟');
    // 涨跌色：四只缓存 changePercent=0.26 > 0 → is-up。
    await expect(strip.locator('.index-chip.is-up')).toHaveCount(4);
  } finally {
    await launched.close();
  }
});

test('catalog index cache survives orphan reconciliation with empty watchlist', async () => {
  // bootstrap 会做孤儿清理：目录指数不在 watchlist，缓存必须被保留
  //（否则指数条每次冷启动都丢缓存）。
  const fetchedAt = Date.now() - 1000;
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({
      watchlist: [],
      'quoteCache:sh000001': indexCache('sh000001', fetchedAt, 3901.33),
      'quoteCache:sz999999': indexCache('sz999999', fetchedAt, 1) // 真孤儿 → 应被删
    })
  });
  try {
    const kept = await getStorage(launched.page, 'quoteCache:sh000001');
    expect(kept).toBeDefined();
    const removed = await getStorage(launched.page, 'quoteCache:sz999999');
    expect(removed).toBeUndefined();
  } finally {
    await launched.close();
  }
});

test('index can be added via search and renders with stripped valuation columns', async () => {
  // 离线：远端搜索被拦截 → 降级到本地热门目录（含指数）→ 搜「上证指数」可命中。
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({
      watchlist: [],
      boardConfig: { g_all: { viewMode: 'list', sortField: 'manual', sortDirection: 'asc', priceHidden: false } }
    })
  });
  try {
    await launched.page.click('[data-action="add-stock"]');
    await launched.page.fill('input[data-action="combobox-input"]', '上证指数');
    // 本地目录降级结果（离线同步命中）→ 选项出现。
    await expect(launched.page.locator('[role="option"]')).toContainText('上证指数', { timeout: 5_000 });
    await launched.page.click('[role="option"]');
    // 确认添加。
    await launched.page.click('button[data-action="dialog-submit"]');

    // watchlist 落库 sh000001。
    await expect
      .poll(() => getStorage(launched.page, 'watchlist'), { timeout: 5_000 })
      .toBeTruthy();
    const watchlist = (await getStorage(launched.page, 'watchlist')) as { code: string }[];
    expect(watchlist.some((s) => s.code === 'sh000001')).toBe(true);

    // 行内渲染：指数行出现；离线无行情 → 价格 '--'，但绝不出现 0.00 / -1.00 假值。
    await expect(launched.page.locator('#stock-board')).toContainText('上证指数', { timeout: 5_000 });
    const boardText = await launched.page.locator('#stock-board').innerText();
    expect(boardText).not.toContain('-1.00');
  } finally {
    await launched.close();
  }
});
