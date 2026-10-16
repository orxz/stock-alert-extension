import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { baseSeed, gridBoardConfig, launchBuiltExtension, stock } from './extension-fixture';

const source = readFileSync('src/popup/components/stock-grid.ts', 'utf8');
const extent = /export const GRID_ROW_EXTENT = (\d+);/.exec(source);
if (!extent) throw new Error('GRID_ROW_EXTENT is missing from the virtual grid implementation');
const GRID_ROW_EXTENT = Number(extent[1]);

test('virtual grid preserves actual row positions and scroll height across spacer windows', async () => {
  const count = 100;
  const launched = await launchBuiltExtension({ offline: true, seed: baseSeed({
    boardConfig: gridBoardConfig(),
    watchlist: Array.from({ length: count }, (_, i) => stock(`sh${600000 + i}`, i))
  }) });
  try {
    const { page } = launched;
    await page.setViewportSize({ width: 420, height: 560 });
    const grid = page.locator('stock-grid');
    await expect(grid.locator('stock-card').first()).toBeVisible();
    const metrics = await grid.evaluate(async (element, rowExtent) => {
      const grid = element as HTMLElement & { viewport: { scrollOffset: number; viewportExtent: number } };
      const container = grid.querySelector<HTMLElement>('[data-region="grid-cards"]')!;
      const positions = [];
      for (const row of [0, 20, 46]) {
        grid.viewport = { scrollOffset: row * rowExtent, viewportExtent: 390 };
        const card = grid.querySelector<HTMLElement>(`[data-key="sh${600000 + row * 2}"]`)!;
        const style = getComputedStyle(container);
        positions.push({
          height: container.scrollHeight,
          offset: card.getBoundingClientRect().top - container.getBoundingClientRect().top - parseFloat(style.paddingTop),
          stride: card.getBoundingClientRect().height + parseFloat(style.rowGap),
          padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
          gap: parseFloat(style.rowGap),
          row
        });
      }
      return positions;
    }, GRID_ROW_EXTENT);
    for (const m of metrics) {
      expect(m.stride).toBe(GRID_ROW_EXTENT);
      expect(m.offset).toBe(m.row * GRID_ROW_EXTENT);
      expect(m.height).toBe(count / 2 * GRID_ROW_EXTENT - m.gap + m.padding);
      expect(m.height).toBe(metrics[0].height);
    }
    expect(launched.errors).toEqual([]);
  } finally { await launched.close(); }
});
