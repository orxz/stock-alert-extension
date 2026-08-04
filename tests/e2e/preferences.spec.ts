// tests/e2e/preferences.spec.ts
// Task 18 Step 4 — 偏好持久化测试。
// 视图模式 / 排序方向 / 价格可见性 → boardConfig 持久化。
import { expect, test } from '@playwright/test';
import { launchBuiltExtension, stock, baseSeed, getStorage } from './extension-fixture';

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
    await expect(launched.page.locator('.stock-card-price')).toContainText('****');
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
