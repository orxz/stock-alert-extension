import { expect, test, type Locator, type Page } from '@playwright/test';
import type { TrendPoint } from '../../src/domain/chart.js';
import { baseSeed, cache, CODES, gridBoardConfig, launchBuiltExtension, stock } from './extension-fixture';

// Controlled data belongs exclusively to this offline browser fixture. The
// extension's real hover/focus events, layout, canvas and loader propagation run.
const POINTS: readonly TrendPoint[] = Array.from({ length: 241 }, (_, index) => {
  const minute = index <= 120 ? 570 + index : 780 + index - 120;
  const price = 1304 + index * 0.08 + Math.sin(index / 13) * 5;
  return {
    time: Date.parse('2026-10-16T00:00:00+08:00') + minute * 60_000,
    price,
    avgPrice: 1304 + index * 0.04,
    high: price + 1,
    low: price - 1,
    volume: 1000 + index,
    amount: 2_500_000,
    volumeRatio: 1.2
  };
});

type MiniHarness = Window & {
  __miniFixture: {
    calls: string[];
    resolve: Partial<Record<string, () => void>>;
    reject: Partial<Record<string, () => void>>;
  };
};

function seed() {
  return baseSeed({
    boardConfig: gridBoardConfig(),
    watchlist: CODES.map((code, index) => stock(code, index)),
    ...Object.fromEntries(CODES.map((code) => {
      const record = cache(code, Date.now(), 1320);
      return [`quoteCache:${code}`, {
        ...record,
        quote: { ...record.quote, prevClose: 1304, open: 1305, high: 1326, low: 1300,
          change: 16, changePercent: 1.23, volume: 123_456, amount: 2_000_000_000 }
      }];
    }))
  });
}

async function installLoader(page: Page, mode: 'ready' | 'deferred' | 'fail-once-deferred' = 'ready'): Promise<void> {
  await expect(page.locator('stock-card').first()).toBeVisible();
  await page.evaluate(({ points, behavior }) => {
    const app = document.querySelector('stock-app') as HTMLElement & {
      setTrendsLoader(loader: (code: string) => Promise<readonly TrendPoint[]>): void;
    };
    if (!app) throw new Error('stock-app is missing');
    const harness: MiniHarness['__miniFixture'] = { calls: [], resolve: {}, reject: {} };
    (window as MiniHarness).__miniFixture = harness;
    app.setTrendsLoader(async (code) => {
      harness.calls.push(code);
      if (behavior === 'fail-once-deferred' && harness.calls.length === 1) {
        return new Promise<readonly TrendPoint[]>((_resolve, reject) => {
          harness.reject[code] = () => reject(new Error('offline fixture'));
        });
      }
      if (behavior === 'deferred') return new Promise((resolve) => {
        harness.resolve[code] = () => resolve(points);
      });
      return points;
    });
  }, { points: POINTS, behavior: mode });
}

async function setHoverDetails(page: Page, enabled: boolean): Promise<void> {
  // Moving focus and pointer off the current row dismisses its tooltip before
  // opening settings, exactly as a user returning to the toolbar would do.
  const settings = page.locator('[data-action="column-settings"]');
  await settings.focus();
  await page.mouse.move(405, 20);
  await settings.click();
  const checkbox = page.getByRole('checkbox', { name: '悬停显示详情' });
  await checkbox.setChecked(enabled);
  // Dismissing the popover under the pointer would hover an unrelated card
  // beneath the checkbox and consume the controlled loader's first request.
  await page.mouse.move(405, 20);
  await page.keyboard.press('Escape');
}

async function expectWithinPopup(tooltip: Locator): Promise<void> {
  await expect(tooltip).toBeVisible();
  await expect.poll(() => tooltip.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const app = document.querySelector('stock-app')!.getBoundingClientRect();
    return rect.left >= Math.max(0, app.left) && rect.top >= Math.max(0, app.top)
      && rect.right <= Math.min(innerWidth, app.right)
      && rect.bottom <= Math.min(innerHeight, app.bottom);
  }), { message: 'all four tooltip edges must stay inside the popup' }).toBe(true);
  await expect(tooltip).toHaveCSS('pointer-events', 'none');
  // A correct bounding box alone cannot detect ancestor clipping. Temporarily
  // enable hit testing for this synchronous paint check, restoring the required
  // pointer-through behavior before another user interaction can occur.
  const paintedAtCorners = await tooltip.evaluate((element) => {
    const tooltip = element as HTMLElement;
    const previous = tooltip.style.pointerEvents;
    try {
      tooltip.style.pointerEvents = 'auto';
      const rect = tooltip.getBoundingClientRect();
      return [rect.left + 10, rect.right - 10].every((x) =>
        [rect.top + 10, rect.bottom - 10].every((y) => {
          const hit = document.elementFromPoint(x, y);
          return hit === tooltip || (hit !== null && tooltip.contains(hit));
        }));
    } finally {
      if (previous) tooltip.style.pointerEvents = previous;
      else tooltip.style.removeProperty('pointer-events');
    }
  });
  expect(paintedAtCorners, 'the tooltip must not be clipped by the scrolling board').toBe(true);
}

async function expectMiniChart(tooltip: Locator): Promise<void> {
  await expect(tooltip.locator('.detail-mini-wrap')).toHaveAttribute('data-state', 'ready');
  await expect(tooltip.locator('[data-field="mini-start"]')).toHaveText('09:30');
  await expect(tooltip.locator('[data-field="mini-end"]')).toHaveText('15:00');
  await expect(tooltip.locator('[data-field="mini-price"]')).toContainText(POINTS.at(-1)!.price.toFixed(2));
  const canvas = tooltip.locator('canvas.detail-mini-trends');
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((element) => {
    const chart = element as HTMLCanvasElement;
    const rect = chart.getBoundingClientRect();
    return Math.abs(chart.width - Math.round(rect.width * devicePixelRatio))
      + Math.abs(chart.height - Math.round(rect.height * devicePixelRatio));
  })).toBeLessThanOrEqual(2);
  const chart = await canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) painted += 1;
    return { width: rect.width, height: rect.height, painted };
  });
  expect(chart.width).toBeGreaterThan(200);
  expect(chart.height).toBeGreaterThanOrEqual(80);
  expect(chart.height).toBeLessThanOrEqual(100);
  expect(chart.painted).toBeGreaterThan(1000);
  await expectWithinPopup(tooltip);
}

async function expectStable(tooltip: Locator): Promise<void> {
  const frames = await tooltip.evaluate(async (element) => {
    const samples: { x: number; y: number; width: number; height: number; visible: boolean }[] = [];
    for (let index = 0; index < 6; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const { x, y, width, height } = element.getBoundingClientRect();
      samples.push({ x, y, width, height, visible: getComputedStyle(element).display !== 'none' });
    }
    return samples;
  });
  for (const sample of frames) {
    expect(sample.visible).toBe(true);
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(sample[dimension] - frames[0][dimension])).toBeLessThanOrEqual(1);
    }
  }
}

test('a right-hand card reserves its mini chart, stays in the popup and respects the opt-out', async ({}, testInfo) => {
  const launched = await launchBuiltExtension({ offline: true, seed: seed() });
  try {
    const { page, context } = launched;
    await page.setViewportSize({ width: 420, height: 560 });
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 420, height: 560, deviceScaleFactor: 2, mobile: false
    });
    expect(await page.evaluate(() => devicePixelRatio)).toBe(2);
    await installLoader(page, 'deferred');
    await setHoverDetails(page, true);
    const card = page.locator(`stock-card[data-key="${CODES[1]}"]`);
    const tooltip = card.locator('.stock-detail-tooltip');
    await card.hover({ position: { x: 20, y: 20 } });
    await expect(tooltip.locator('.detail-mini-wrap')).toHaveAttribute('data-state', 'loading');
    await expect(tooltip.locator('.detail-mini-status')).toContainText('加载中');
    await expectWithinPopup(tooltip);
    const loading = await tooltip.boundingBox();
    await page.evaluate((code) => {
      const resolve = (window as MiniHarness).__miniFixture.resolve[code];
      if (!resolve) throw new Error('hover did not start a chart request');
      resolve();
    }, CODES[1]);
    await expectMiniChart(tooltip);
    const loaded = await tooltip.boundingBox();
    expect(loading).not.toBeNull();
    expect(loaded).not.toBeNull();
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(loaded![dimension] - loading![dimension])).toBeLessThanOrEqual(1);
    }
    await expectStable(tooltip);
    const canvas = tooltip.locator('canvas.detail-mini-trends');
    const backingSize = await canvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      return { width: canvas.width, height: canvas.height };
    });
    await page.mouse.move(405, 20);
    await expect(tooltip).toBeHidden();
    // A real Store update reapplies cached card view models while their canvas
    // measures 0 CSS pixels. Backing dimensions must not be used as CSS pixels
    // and multiplied by DPR again on each hidden redraw.
    for (const theme of ['light', 'dark']) {
      await page.locator('stock-app').evaluate(async (app, nextTheme) => {
        app.dispatchEvent(new CustomEvent('theme-change', {
          detail: { theme: nextTheme }, bubbles: true
        }));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }, theme);
      await expect(tooltip).toBeHidden();
      expect(await canvas.evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        return { width: canvas.width, height: canvas.height };
      })).toEqual(backingSize);
    }
    await card.hover({ position: { x: 20, y: 20 } });
    await expectMiniChart(tooltip);
    expect(await canvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      return { width: canvas.width, height: canvas.height };
    })).toEqual(backingSize);
    await page.screenshot({ path: testInfo.outputPath('hover-grid-right.png'), scale: 'css' });
    await setHoverDetails(page, false);
    await card.hover({ position: { x: 20, y: 20 } });
    await expect(tooltip).toBeHidden();
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});

test('bottom grid and list rows expose complete mini charts through keyboard focus', async ({}, testInfo) => {
  const launched = await launchBuiltExtension({ offline: true, seed: seed() });
  try {
    const { page } = launched;
    await page.setViewportSize({ width: 420, height: 560 });
    await installLoader(page);
    await setHoverDetails(page, true);
    const board = page.locator('stock-board');
    await board.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const card = page.locator(`stock-card[data-key="${CODES.at(-1)}"]`);
    await card.focus();
    const cardTooltip = card.locator('.stock-detail-tooltip');
    await expectMiniChart(cardTooltip);
    await expectStable(cardTooltip);
    const adjacentCard = page.locator(`stock-card[data-key="${CODES.at(-2)}"]`);
    await adjacentCard.hover({ position: { x: 20, y: 20 } });
    await expect(card).toBeFocused();
    await expect(adjacentCard.locator('.stock-detail-tooltip')).toBeVisible();
    await expect(page.locator('.stock-detail-tooltip:visible')).toHaveCount(1);
    await page.mouse.move(405, 20);
    await expect(card).toBeFocused();
    await expect(cardTooltip).toBeVisible();
    await expect(page.locator('.stock-detail-tooltip:visible')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('hover-grid-bottom.png'), scale: 'css' });

    const listButton = page.locator('[data-action="view-list"]');
    await listButton.focus();
    await page.mouse.move(405, 20);
    await listButton.click();
    await page.locator('[data-action="theme-toggle"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await board.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const row = page.locator(`tr[data-key="${CODES.at(-1)}"]`);
    await row.locator('[data-action="stock-menu"]').focus();
    const rowTooltip = row.locator('.stock-detail-tooltip');
    await expectMiniChart(rowTooltip);
    await expectStable(rowTooltip);
    await page.locator(`tr[data-key="${CODES.at(-2)}"]`).hover({ position: { x: 20, y: 20 } });
    await expect(rowTooltip).toBeHidden();
    await expect(page.locator('.stock-detail-tooltip:visible')).toHaveCount(1);
    await page.mouse.move(405, 20);
    await expect(rowTooltip).toBeVisible();
    await expect(page.locator('.stock-detail-tooltip:visible')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('hover-list-bottom-light.png'), scale: 'css' });
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});

test('a chart request failing after pointer exit can recover on the next hover', async () => {
  const launched = await launchBuiltExtension({ offline: true, seed: seed() });
  try {
    const { page } = launched;
    await page.setViewportSize({ width: 420, height: 560 });
    await installLoader(page, 'fail-once-deferred');
    await setHoverDetails(page, true);
    const card = page.locator(`stock-card[data-key="${CODES[0]}"]`);
    const tooltip = card.locator('.stock-detail-tooltip');
    await card.hover({ position: { x: 20, y: 20 } });
    await expect(tooltip.locator('.detail-mini-wrap')).toHaveAttribute('data-state', 'loading');
    await page.mouse.move(405, 20);
    await expect(tooltip).toBeHidden();
    await page.evaluate(async (code) => {
      const reject = (window as MiniHarness).__miniFixture.reject[code];
      if (!reject) throw new Error('hover did not start the deferred chart request');
      reject();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }, CODES[0]);
    await expect(tooltip.locator('.detail-mini-wrap')).toHaveAttribute('data-state', 'error');
    await expect(tooltip.locator('.detail-mini-status')).toContainText('分时加载失败');
    await expect(tooltip.locator('.detail-mini-status')).toContainText('重试');
    await expect(tooltip).toBeHidden();
    await card.hover({ position: { x: 20, y: 20 } });
    await expectMiniChart(tooltip);
    expect(await page.evaluate((code) =>
      (window as MiniHarness).__miniFixture.calls.filter((requested) => requested === code).length,
    CODES[0])).toBe(2);
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});
