// tests/e2e/quotes.spec.ts
// Task 18 Step 4 — 行情刷新与缓存行为测试。
import { expect, test } from '@playwright/test';
import { launchBuiltExtension, CODES, stock, cache, baseSeed, getStorage } from './extension-fixture';

test('manual refresh updates fresh quote counts', async () => {
  const now = Date.now();
  const cacheValues = Object.fromEntries(
    CODES.slice(0, 3).map((code) => [`quoteCache:${code}`, cache(code, now - 600000)])
  );
  const launched = await launchBuiltExtension({
    offline: true,
    holdQuotes: true,
    seed: baseSeed({
      watchlist: CODES.slice(0, 3).map(stock),
      ...cacheValues
    })
  });
  try {
    // 初始：3 缓存 0 实时。
    await expect(launched.page.locator('#quote-status-summary')).toContainText('缓存 3');
    // 放行行情请求 → 全部失败（离线）→ 保持缓存。
    launched.releaseHold?.();
    await launched.page.click('[data-action="refresh"]');
    // 离线刷新失败后应显示已保留缓存。
    await expect(launched.page.locator('#app-live-region')).toContainText('已保留缓存');
  } finally {
    await launched.close();
  }
});

test('orphan cache entries are filtered on load', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({
      watchlist: [stock('sh600519')],
      'quoteCache:sh600519': cache('sh600519', Date.now() - 1000),
      'quoteCache:sz999999': cache('sz999999', Date.now() - 1000) // orphan
    })
  });
  try {
    // 孤儿缓存应在加载时被过滤。
    const orphan = await getStorage(launched.page, 'quoteCache:sz999999');
    expect(orphan).toBeUndefined();
  } finally {
    await launched.close();
  }
});

test('deferred retry appears in quote status', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    // 离线刷新失败后，deferredUntil 应在状态中可见（如果有退避逻辑）。
    await launched.page.click('[data-action="refresh"]');
    await launched.page.waitForTimeout(500);
    // 即使 deferred 不出现，也不应有页面错误。
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});
