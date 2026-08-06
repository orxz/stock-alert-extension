// tests/e2e/stock-actions.spec.ts
// 计划 Task 6 — 行内 ••• 操作菜单在真实扩展中的行为。
import { expect, test } from '@playwright/test';
import { launchBuiltExtension, stock, baseSeed, getStorage } from './extension-fixture';

/** 三只自选股，manualOrder 0/1/2。 */
function threeStocks() {
  return baseSeed({
    watchlist: [stock('sh600519', 0), stock('sz000001', 1), stock('sz300750', 2)]
  });
}

const TRIGGER = (code: string) => `#stock-actions-${code}`;

test('the row menu opens with actions scoped to that stock', async () => {
  const launched = await launchBuiltExtension({ offline: true, seed: threeStocks() });
  try {
    const page = launched.page;
    await page.click(TRIGGER('sz000001'));

    await expect(page.locator('.stock-action-menu')).toBeVisible();
    await expect(page.locator('button[data-action="pin"]')).toContainText('置顶');
    // 中间那只：上下都可移动。
    await expect(page.locator('button[data-action="move-up"]')).toBeEnabled();
    await expect(page.locator('button[data-action="move-down"]')).toBeEnabled();
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});

test('move buttons are disabled at the list boundaries', async () => {
  const launched = await launchBuiltExtension({ offline: true, seed: threeStocks() });
  try {
    const page = launched.page;
    await page.click(TRIGGER('sh600519'));
    await expect(page.locator('button[data-action="move-up"]')).toBeDisabled();
    await expect(page.locator('button[data-action="move-down"]')).toBeEnabled();
  } finally {
    await launched.close();
  }
});

test('pinning from the menu persists and closes the menu', async () => {
  const launched = await launchBuiltExtension({ offline: true, seed: threeStocks() });
  try {
    const page = launched.page;
    await page.click(TRIGGER('sz300750'));
    await page.click('button[data-action="pin"]');

    await expect(page.locator('.stock-action-menu')).toBeHidden();
    await expect
      .poll(async () => {
        const list = await getStorage<Array<{ code: string; pinned: Record<string, boolean> }>>(
          page,
          'watchlist'
        );
        return list?.find((s) => s.code === 'sz300750')?.pinned?.g_all ?? false;
      })
      .toBe(true);
  } finally {
    await launched.close();
  }
});

test('delete asks for confirmation instead of removing immediately', async () => {
  const launched = await launchBuiltExtension({ offline: true, seed: threeStocks() });
  try {
    const page = launched.page;
    await page.click(TRIGGER('sz000001'));
    await page.click('button[data-action="remove"]');

    // 必须先出确认对话框——删除自选股不可撤销。
    await expect(page.locator('dialog')).toBeVisible();

    // 此刻自选股一只都不能少。
    const before = await getStorage<unknown[]>(page, 'watchlist');
    expect(before).toHaveLength(3);
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});

test('escape closes the menu and returns focus to its trigger', async () => {
  const launched = await launchBuiltExtension({ offline: true, seed: threeStocks() });
  try {
    const page = launched.page;
    await page.click(TRIGGER('sz000001'));
    await expect(page.locator('.stock-action-menu')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('.stock-action-menu')).toBeHidden();
    await expect(page.locator(TRIGGER('sz000001'))).toBeFocused();
  } finally {
    await launched.close();
  }
});
