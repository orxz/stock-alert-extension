import { expect, test } from '@playwright/test';
import { baseSeed, gridBoardConfig, launchBuiltExtension, stock } from './extension-fixture';

test('settings retain keyboard focus after updating a column', async () => {
  const launched = await launchBuiltExtension({ offline: true, seed: baseSeed({
    boardConfig: gridBoardConfig(), watchlist: [stock('sh600519')]
  }) });
  try {
    const { page } = launched;
    await page.locator('[data-action="column-settings"]').click();
    const checkbox = page.locator('column-panel input[data-column="amount"]');
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-column-item="amount"] [data-action="col-up"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-column-item="amount"] [data-action="col-up"]')).toBeFocused();
    await page.keyboard.press('Escape');
    const trigger = page.locator('stock-card [data-action="stock-menu"]').first();
    await trigger.click();
    await expect(page.locator('stock-action-menu [data-action="pin"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    expect(launched.errors).toEqual([]);
  } finally { await launched.close(); }
});

test('stock menu follows scrolling, stays inside the popup and closes when virtualized away', async () => {
  const launched = await launchBuiltExtension({ offline: true, seed: baseSeed({
    boardConfig: gridBoardConfig(),
    watchlist: Array.from({ length: 100 }, (_, i) => stock(`sh${600000 + i}`, i))
  }) });
  try {
    const { page } = launched;
    await page.setViewportSize({ width: 420, height: 560 });
    const trigger = page.locator('stock-card [data-action="stock-menu"]').first();
    await trigger.click();
    const panel = page.locator('.app-popover');
    await expect(panel).toBeVisible();
    const initialTop = (await panel.boundingBox())!.y;
    const board = page.locator('stock-board');
    await board.evaluate((element) => { element.scrollTop = 30; });
    await expect.poll(async () => (await panel.boundingBox())!.y).toBeLessThan(initialTop);
    await board.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(page.locator('stock-card[data-key="sh600000"]')).toHaveCount(0);
    await expect(panel).toBeHidden();
    const bottomTrigger = page.locator('stock-card [data-action="stock-menu"]').last();
    await bottomTrigger.click();
    await expect(panel).toBeVisible();
    const bounds = (await panel.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(8);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(552);
    expect(launched.errors).toEqual([]);
  } finally { await launched.close(); }
});
