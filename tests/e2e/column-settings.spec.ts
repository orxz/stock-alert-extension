// tests/e2e/column-settings.spec.ts
// 计划 Task 5–6 —「列设置」在真实扩展中确实可用。
//
// 回归背景：v2.0.0 里工具栏的「列设置」按钮会发出 column-panel-open-request，
// 但 app-shell 用一行注释显式忽略了该事件——ColumnPanelElement 已实现、已注册、
// 有 236 行组件测试，用户点下去却毫无反应。全部门禁都是绿的。
import { expect, test } from '@playwright/test';
import { launchBuiltExtension, stock, baseSeed } from './extension-fixture';

const COLUMN_TRIGGER = '[data-action="column-settings"]';

test('column settings button opens a working panel', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    const page = launched.page;
    await expect(page.locator(COLUMN_TRIGGER)).toBeVisible();
    await expect(page.locator('.app-popover')).toBeHidden();

    await page.click(COLUMN_TRIGGER);

    await expect(page.locator('.app-popover')).toBeVisible();
    await expect(page.locator('.column-panel-list li')).toHaveCount(6);
    await expect(page.locator(COLUMN_TRIGGER)).toHaveAttribute('aria-expanded', 'true');
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});

test('disabling a column hides it and the choice survives reopening the popup', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    const page = launched.page;
    // 成交额列初始可见。
    await expect(page.locator('thead th[data-column="amount"]')).toBeVisible();

    await page.click(COLUMN_TRIGGER);
    await page.uncheck('input[data-column="amount"]');

    await expect(page.locator('thead th[data-column="amount"]')).toBeHidden();

    // 重开 popup：偏好来自 localStorage，应保持关闭。
    const reopened = await launched.context.newPage();
    await reopened.goto(page.url());
    await expect(reopened.locator('thead th[data-column="amount"]')).toBeHidden();
    await expect(reopened.locator('thead th[data-column="price"]')).toBeVisible();
  } finally {
    await launched.close();
  }
});

test('required columns cannot be switched off', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    const page = launched.page;
    await page.click(COLUMN_TRIGGER);
    // 现价是必需列——取消勾选后应被强制勾回，列保持可见。
    await page.locator('input[data-column="price"]').uncheck({ force: true }).catch(() => {});
    await expect(page.locator('input[data-column="price"]')).toBeChecked();
    await expect(page.locator('thead th[data-column="price"]')).toBeVisible();
  } finally {
    await launched.close();
  }
});

test('escape closes the popover and returns focus to the trigger', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    const page = launched.page;
    await page.click(COLUMN_TRIGGER);
    await expect(page.locator('.app-popover')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('.app-popover')).toBeHidden();
    await expect(page.locator(COLUMN_TRIGGER)).toBeFocused();
    await expect(page.locator(COLUMN_TRIGGER)).toHaveAttribute('aria-expanded', 'false');
  } finally {
    await launched.close();
  }
});
