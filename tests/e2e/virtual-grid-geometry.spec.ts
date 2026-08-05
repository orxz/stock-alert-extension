import { expect, test } from '@playwright/test';
import { baseSeed, launchBuiltExtension } from './extension-fixture.js';

test('virtual grid keeps 126px row geometry when spacer rows are present', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed()
  });
  const { page, close } = launched;

  try {
    await page.setViewportSize({ width: 420, height: 560 });
    const metrics = await page.evaluate(async () => {
      await customElements.whenDefined('stock-grid');
      const grid = document.querySelector('stock-grid') as HTMLElement & {
        viewModel: unknown[];
        viewport: { scrollOffset: number; viewportExtent: number };
      };
      const stocks = Array.from({ length: 100 }, (_, index) => ({
        code: `sh${String(600000 + index).padStart(6, '0')}`,
        name: `股票${index}`,
        price: 100,
        change: 1,
        changePercent: 1,
        status: 'fresh',
        pinned: false,
        staleLabel: '',
        displayPrice: '100.00',
        displayChange: '+1.00',
        displayAmount: '1.2亿'
      }));

      grid.hidden = false;
      grid.viewModel = stocks;
      grid.viewport = { scrollOffset: 0, viewportExtent: 390 };
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const container = grid.querySelector('[data-region="grid-cards"]') as HTMLElement;
      const startHeight = container.scrollHeight;

      grid.viewport = { scrollOffset: 126 * 20, viewportExtent: 390 };
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const target = grid.querySelector('[data-key="sh600040"]') as HTMLElement;
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const paddingTop = Number.parseFloat(getComputedStyle(container).paddingTop);

      return {
        startHeight,
        middleHeight: container.scrollHeight,
        targetOffset: targetRect.top - containerRect.top - paddingTop,
        rowGap: getComputedStyle(container).rowGap,
        beforeSpacerHeight: (grid.querySelector('.stock-grid-spacer--before') as HTMLElement)
          .getBoundingClientRect().height
      };
    });

    expect(metrics.rowGap).toBe('8px');
    expect(metrics.beforeSpacerHeight).toBe(126 * 16);
    expect(metrics.targetOffset).toBe(126 * 20);
    expect(metrics.startHeight).toBe(126 * 50);
    expect(metrics.middleHeight).toBe(metrics.startHeight);
  } finally {
    await close();
  }
});
