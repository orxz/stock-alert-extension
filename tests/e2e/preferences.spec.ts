// tests/e2e/preferences.spec.ts
// Task 18 Step 4 — 偏好持久化测试。
// 视图模式 / 排序方向 / 价格可见性 → boardConfig 持久化。
import { expect, test } from '@playwright/test';
import { launchBuiltExtension, stock, baseSeed, getStorage } from './extension-fixture';

/**
 * 首次打开的默认形态：深色主题 + 网格视图。
 *
 * 这是产品决定的第一印象，不是实现细节——没有配置（boardConfig 为空、
 * 未写过 uiTheme）时必须是这个样子。默认值散落在 DEFAULT_BOARD_CONFIG 与
 * popup/main.ts 两处，任何一处漂移都会改变全新用户看到的界面，
 * 而其余用例大多显式声明视图，抓不到这种回归。
 */
test('a fresh profile opens in dark theme and grid view', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    // 不设 boardConfig：走 DEFAULT_BOARD_CONFIG。
    seed: baseSeed({ watchlist: [stock('sh600519'), stock('sz000001')] })
  });
  try {
    const page = launched.page;
    await page.waitForSelector('stock-app');
    // 深色：main.ts 在 Store 创建前就写 data-theme，避免闪烁。
    await expect.poll(async () => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    // 网格：看板只挂载激活视图，所以卡片在、表格不在。
    await expect(page.locator('stock-card').first()).toBeVisible();
    await expect(page.locator('stock-table table')).toHaveCount(0);
    // 工具栏的「网格」按钮应处于选中态。
    await expect(page.locator('[data-action="view-grid"]')).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await launched.close();
  }
});

test('view mode preference persists', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    // 点击网格视图按钮。
    await launched.page.click('[data-action="view-grid"]');
    await expect.poll(async () => {
      const cfg = await getStorage<{ g_all?: { viewMode?: string } }>(launched.page, 'boardConfig');
      return cfg?.g_all?.viewMode;
    }).toBe('grid');

    // 再切回列表。
    await launched.page.click('[data-action="view-list"]');
    await expect.poll(async () => {
      const cfg = await getStorage<{ g_all?: { viewMode?: string } }>(launched.page, 'boardConfig');
      return cfg?.g_all?.viewMode;
    }).toBe('list');
  } finally {
    await launched.close();
  }
});

test('sort preference persists', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    // 选择「名称（A→Z）」排序。
    await launched.page.selectOption('[data-action="sort"]', 'name:asc');
    await expect.poll(async () => {
      const cfg = await getStorage<{ g_all?: { sortField?: string; sortDirection?: string } }>(launched.page, 'boardConfig');
      return cfg?.g_all?.sortField;
    }).toBe('name');
    const cfg = await getStorage<{ g_all?: { sortDirection?: string } }>(launched.page, 'boardConfig');
    expect(cfg?.g_all?.sortDirection).toBe('asc');
  } finally {
    await launched.close();
  }
});

test('price hidden preference persists', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    // 点击隐藏价格。
    await launched.page.click('[data-action="price-visibility"]');
    await expect.poll(async () => {
      const cfg = await getStorage<{ g_all?: { priceHidden?: boolean } }>(launched.page, 'boardConfig');
      return cfg?.g_all?.priceHidden;
    }).toBe(true);
    // 价格掩码显示。
    await expect(launched.page.locator('[data-field="price"]')).toContainText('****');
    // 再切回可见。
    await launched.page.click('[data-action="price-visibility"]');
    await expect.poll(async () => {
      const cfg = await getStorage<{ g_all?: { priceHidden?: boolean } }>(launched.page, 'boardConfig');
      return cfg?.g_all?.priceHidden;
    }).toBe(false);
  } finally {
    await launched.close();
  }
});

test('reopening popup shows persisted view mode', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({
      watchlist: [stock('sh600519')],
      boardConfig: { g_all: { viewMode: 'grid', sortField: 'manual', sortDirection: 'asc', priceHidden: false } }
    })
  });
  try {
    // 加载后应直接显示网格视图。
    await expect(launched.page.locator('[data-action="view-grid"]')).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await launched.close();
  }
});
