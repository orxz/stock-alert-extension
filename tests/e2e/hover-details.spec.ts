import { expect, test } from '@playwright/test';
import { baseSeed, launchBuiltExtension, stock } from './extension-fixture';

test('hover details are off by default, opt in across both views, and persist on reopen', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519'), stock('sz000001')] })
  });
  try {
    const { page, context } = launched;
    await page.setViewportSize({ width: 420, height: 560 });
    const card = page.locator('stock-card[data-key="sh600519"]');
    const tooltip = card.locator('.stock-detail-tooltip');
    await card.hover();
    await expect(tooltip).toBeHidden();
    await card.focus();
    await expect(tooltip).toBeHidden();

    // 主动查看仍然可用。
    await card.locator('[data-field="name"]').click();
    await expect(page.locator('chart-detail-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('chart-detail-panel')).toBeHidden();

    await page.click('[data-action="column-settings"]');
    const toggle = page.getByRole('checkbox', { name: '悬停显示详情' });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.keyboard.press('Escape');
    await card.hover();
    await expect(tooltip).toBeVisible();

    await page.click('[data-action="view-list"]');
    const row = page.locator('tr[data-key="sh600519"]');
    await row.hover();
    await expect(row.locator('.stock-detail-tooltip')).toBeVisible();

    const reopened = await context.newPage();
    await reopened.setViewportSize({ width: 420, height: 560 });
    await reopened.goto(page.url());
    const reopenedRow = reopened.locator('tr[data-key="sh600519"]');
    await reopenedRow.hover();
    await expect(reopenedRow.locator('.stock-detail-tooltip')).toBeVisible();
    await reopened.click('[data-action="column-settings"]');
    await expect(reopened.getByRole('checkbox', { name: '悬停显示详情' })).toBeChecked();
    await reopened.getByRole('checkbox', { name: '悬停显示详情' }).uncheck();
    await reopened.keyboard.press('Escape');
    await reopenedRow.hover();
    await expect(reopenedRow.locator('.stock-detail-tooltip')).toBeHidden();
    await reopened.click('[data-action="view-grid"]');
    const reopenedCard = reopened.locator('stock-card[data-key="sh600519"]');
    await reopenedCard.hover();
    await expect(reopenedCard.locator('.stock-detail-tooltip')).toBeHidden();
    await reopened.reload();
    await reopenedCard.hover();
    await expect(reopenedCard.locator('.stock-detail-tooltip')).toBeHidden();
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});
