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
    // 面板只展示 5 个可配置列——锁定列「名称」不进入设置。
    await expect(page.locator('.column-panel-list li')).toHaveCount(5);
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

test('the locked name column is absent and price can be switched off', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    const page = launched.page;
    await page.click(COLUMN_TRIGGER);
    // 锁定列 name 不进入面板——用户无法取消它，也就不会遇到「取消弹回」。
    await expect(page.locator('input[data-column="name"]')).toHaveCount(0);
    // 现价是可配置列：取消后表格价格列隐藏，不再被强制勾回。
    await page.uncheck('input[data-column="price"]');
    await expect(page.locator('thead th[data-column="price"]')).toBeHidden();
    // 锁定列名称始终可见。
    await expect(page.locator('thead th[data-column="name"]')).toBeVisible();
    // 重开 popup：取消偏好来自 localStorage，应保持关闭。
    const reopened = await launched.context.newPage();
    await reopened.goto(page.url());
    await expect(reopened.locator('thead th[data-column="price"]')).toBeHidden();
    await expect(reopened.locator('thead th[data-column="name"]')).toBeVisible();
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

test('grid cards apply column settings', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    const page = launched.page;
    // 切到网格视图——卡片初始显示成交额。
    await page.click('[data-action="view-grid"]');
    await expect(page.locator('stock-card[data-key="sh600519"] .stock-card-amount')).toBeVisible();

    // 打开列设置，取消「成交额」。
    await page.click(COLUMN_TRIGGER);
    await page.uncheck('input[data-column="amount"]');
    await expect(page.locator('stock-card[data-key="sh600519"] .stock-card-amount')).toBeHidden();
    // 锁定列「名称」与必需列仍显示。
    await expect(page.locator('stock-card[data-key="sh600519"] [data-field="name"]')).toBeVisible();
    await expect(page.locator('stock-card[data-key="sh600519"] [data-field="price"]')).toBeVisible();
  } finally {
    await launched.close();
  }
});

test('reordering a column reorders the table columns persistently', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    const page = launched.page;
    // 默认主列顺序：name, price, changePercent, amount。
    await expect(page.locator('thead th[data-column="amount"]')).toBeVisible();

    await page.click(COLUMN_TRIGGER);
    // 把「成交额」上移一位（与「涨跌幅」交换）。
    await page.locator('[data-column-item="amount"] button[data-action="col-up"]').click();

    // 表头与数据行的列顺序必须一致：name, price, amount, changePercent。
    const headerOrder = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('thead th[data-column]'));
      return ths
        .filter((th) => th.getAttribute('data-column') !== 'select')
        .map((th) => th.getAttribute('data-column'));
    });
    expect(headerOrder).toEqual(['name', 'price', 'amount', 'changePercent']);
    const rowOrder = await page.evaluate(() => {
      const tds = Array.from(document.querySelectorAll('tbody tr[data-key] td[data-column]'));
      return tds
        .filter((td) => td.getAttribute('data-column') !== 'select')
        .map((td) => td.getAttribute('data-column'));
    });
    expect(rowOrder).toEqual(['name', 'price', 'amount', 'changePercent']);

    // 重开 popup：重排后的顺序从 localStorage 恢复。
    const reopened = await launched.context.newPage();
    await reopened.goto(page.url());
    const reopenedOrder = await reopened.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('thead th[data-column]'));
      return ths
        .filter((th) => th.getAttribute('data-column') !== 'select')
        .map((th) => th.getAttribute('data-column'));
    });
    expect(reopenedOrder).toEqual(['name', 'price', 'amount', 'changePercent']);
  } finally {
    await launched.close();
  }
});
