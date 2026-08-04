// tests/e2e/ui-redesign.spec.ts
// Task 11 — UI 焕新 E2E 集成测试。
// 覆盖：主题切换持久化、固定 420×560 布局不溢出、状态栏可见、表格成交额列。
import { test, expect } from '@playwright/test';
import { launchBuiltExtension, baseSeed, CODES, stock, cache } from './extension-fixture';

const now = Date.now();

function seedWithQuotes() {
  return baseSeed({
    watchlist: CODES.map((code, i) => stock(code, i)),
    boardConfig: { g_all: { viewMode: 'list', sortField: 'manual' } },
    ...Object.fromEntries(
      CODES.map((code, i) => {
        const q = cache(code, now, 10 + i);
        return [
          [`quoteCache:${code}`],
          {
            ...q,
            quote: { ...q.quote, price: 10 + i, amount: 1_000_000_000 + i * 100_000_000 }
          }
        ];
      })
    )
  });
}

test('theme toggle changes data-theme and persists', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    holdQuotes: true,
    seed: seedWithQuotes()
  });
  const { page, close } = launched;
  try {
    await page.setViewportSize({ width: 420, height: 560 });
    // 等待 header 渲染（主题按钮）。
    await page.waitForSelector('[data-action="theme-toggle"]', { timeout: 10_000 });
    // 初始为深色（localStorage 无 uiTheme 时默认 dark）。
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // 点击主题按钮 → 切换到浅色。
    await page.click('[data-action="theme-toggle"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // 重开 popup 保留浅色偏好（持久化到 localStorage）。
    await page.reload();
    await page.waitForSelector('[data-action="theme-toggle"]', { timeout: 10_000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  } finally {
    await close();
  }
});

test('popup body does not overflow 560px', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    holdQuotes: true,
    seed: seedWithQuotes()
  });
  const { page, close } = launched;
  try {
    await page.setViewportSize({ width: 420, height: 560 });
    // 等待看板内容可见（列表/网格视图至少一个渲染）。
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('stock-card, stock-table')].some((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }),
      { timeout: 10_000 }
    );
    const metrics = await page.evaluate(() => ({
      bodyH: document.body.clientHeight,
      scrollH: document.body.scrollHeight
    }));
    expect(metrics.bodyH).toBeLessThanOrEqual(560);
    expect(metrics.scrollH).toBeLessThanOrEqual(560);
  } finally {
    await close();
  }
});

test('status bar is visible within viewport', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    holdQuotes: true,
    seed: seedWithQuotes()
  });
  const { page, close } = launched;
  try {
    await page.setViewportSize({ width: 420, height: 560 });
    await page.waitForSelector('quote-status', { timeout: 10_000 });
    const box = await page.locator('quote-status').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(560);
  } finally {
    await close();
  }
});

test('table shows amount column', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    holdQuotes: true,
    seed: seedWithQuotes()
  });
  const { page, close } = launched;
  try {
    await page.setViewportSize({ width: 420, height: 560 });
    // 等待表格可见（列表视图渲染 stock-table）。
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('stock-table')].some((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }),
      { timeout: 10_000 }
    );
    const headers = await page.locator('stock-table th').allTextContents();
    expect(headers).toContain('成交额');
  } finally {
    await close();
  }
});
