import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { ChartData, ChartKind, KlinePeriod } from '../../src/domain/chart.js';
import { baseSeed, gridBoardConfig, launchBuiltExtension, stock } from './extension-fixture';

// Only the injected loader uses fixture data. The built extension, Store, DOM,
// canvas, keyboard handling, and CSS all run in a real, offline Chromium page.
const CODE = 'sh600519';
const NAME = '贵州茅台';
const trends: ChartData = {
  code: CODE,
  kind: 'trends',
  name: NAME,
  prevClose: 1304,
  fetchedAt: Date.parse('2026-10-16T07:00:00Z'),
  trends: [
    ['09:30', 1305.10, 1305.10],
    ['10:15', 1301.25, 1303.25],
    ['11:30', 1315.75, 1308.50],
    ['13:01', 1310.10, 1309.25],
    ['15:00', 1325.75, 1312.30]
  ].map(([time, price, avgPrice], index) => ({
    time: Date.parse(`2026-10-16T${time}:00+08:00`),
    price: Number(price),
    avgPrice: Number(avgPrice),
    high: Number(price) + 1,
    low: Number(price) - 1,
    volume: 1000 + index * 250,
    amount: 130_000_000 + index * 20_000_000,
    volumeRatio: 1.2
  }))
};

function klines(period: KlinePeriod): ChartData {
  const start = { day: 1300, week: 1400, month: 1500 }[period];
  return {
    code: CODE,
    kind: 'kline',
    name: NAME,
    fetchedAt: trends.fetchedAt,
    klines: Array.from({ length: 24 }, (_, index) => ({
      date: new Date(period === 'month'
        ? Date.UTC(2024, 10 + index, 1)
        : Date.UTC(2026, 3, 1 + index * (period === 'week' ? 7 : 1))).toISOString().slice(0, 10),
      open: start + index - 0.25,
      close: start + index + 0.75,
      high: start + index + 2,
      low: start + index - 2,
      volume: 25_000 + index * 1000,
      amount: 5_250_000_000 + index * 10_000_000,
      changePercent: 0.75,
      turnoverRate: 1.25
    }))
  };
}

type FixtureData = Record<'trends' | KlinePeriod, ChartData>;
type ChartHarness = Window & {
  __chartFixture: {
    deferred: KlinePeriod | null;
    pending: Partial<Record<KlinePeriod, () => void>>;
  };
};

async function installLoader(page: Page, deferred: KlinePeriod | null = null): Promise<void> {
  await expect(page.locator(`stock-card[data-key="${CODE}"]`)).toBeVisible();
  await page.evaluate(({ data, defer }) => {
    const panel = document.querySelector('chart-detail-panel') as HTMLElement & {
      setLoader(loader: (code: string, kind: ChartKind, period: KlinePeriod) => Promise<ChartData>): void;
    };
    if (!panel) throw new Error('chart-detail-panel is missing');
    const harness = { deferred: defer, pending: {} } as ChartHarness['__chartFixture'];
    (window as ChartHarness).__chartFixture = harness;
    panel.setLoader(async (_code, kind, period) => {
      const result = data[kind === 'trends' ? 'trends' : period];
      if (kind === 'kline' && period === harness.deferred) {
        return new Promise((resolve) => {
          harness.pending[period] = () => resolve(result);
        });
      }
      return result;
    });
  }, {
    data: { trends, day: klines('day'), week: klines('week'), month: klines('month') } satisfies FixtureData,
    defer: deferred
  });
}

async function openChart(page: Page): Promise<void> {
  await page.locator(`stock-card[data-key="${CODE}"] [data-field="name"]`).click();
  await expect(page.locator('chart-detail-panel')).toBeVisible();
  await expect(page.locator('[data-region="detail-title"]')).toContainText(NAME);
}

async function expectChartFits(page: Page): Promise<void> {
  const canvas = page.locator('chart-detail-panel canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((element) => {
    const chart = element as HTMLCanvasElement;
    const bounds = chart.getBoundingClientRect();
    return Math.abs(chart.width - Math.round(bounds.width * devicePixelRatio))
      + Math.abs(chart.height - Math.round(bounds.height * devicePixelRatio));
  })).toBeLessThanOrEqual(2);

  const layout = await page.locator('chart-detail-panel').evaluate((panel) => {
    const bounds = panel.getBoundingClientRect();
    const app = document.querySelector('stock-app')!.getBoundingClientRect();
    const chart = panel.querySelector('canvas')!;
    const chartBounds = chart.getBoundingClientRect();
    const metrics = panel.querySelector<HTMLElement>('[data-region="detail-metrics"]')!;
    if (!metrics || !metrics.childElementCount) throw new Error('chart readout must exist');
    const overflowing = [...metrics.querySelectorAll<HTMLElement>('*')].filter((item) => {
      const rect = item.getBoundingClientRect();
      const parent = item.parentElement!.getBoundingClientRect();
      return rect.left < parent.left - 1 || rect.right > parent.right + 1
        || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1;
    }).map((item) => item.textContent);
    const pixels = chart.getContext('2d')!.getImageData(0, 0, chart.width, chart.height).data;
    let paintedPixels = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) paintedPixels += 1;
    return {
      width: chartBounds.width,
      height: chartBounds.height,
      insideApp: bounds.left >= app.left && bounds.right <= app.right
        && bounds.top >= app.top && bounds.bottom <= app.bottom,
      canvasAboveMetrics: chartBounds.bottom <= metrics.getBoundingClientRect().top + 1,
      metricsOverflow: metrics.scrollWidth - metrics.clientWidth,
      overflowing,
      paintedPixels
    };
  });
  expect(layout.insideApp).toBe(true);
  expect(layout.width).toBeGreaterThan(300);
  expect(layout.height).toBeGreaterThan(200);
  expect(layout.canvasAboveMetrics).toBe(true);
  expect(layout.metricsOverflow).toBeLessThanOrEqual(1);
  expect(layout.overflowing).toEqual([]);
  expect(layout.paintedPixels).toBeGreaterThan(1000);
}

test('trends and every K-line period have readable keyboard inspection and fit both themes at high DPI', async () => {
  test.setTimeout(60_000);
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [{ ...stock(CODE), name: NAME }], boardConfig: gridBoardConfig() })
  });
  try {
    const { page, context } = launched;
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 420, height: 560, deviceScaleFactor: 2, mobile: false
    });
    await installLoader(page);
    const metrics = page.locator('[data-region="detail-metrics"]');
    const canvas = page.locator('chart-detail-panel canvas');

    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.getByRole('button', { name: '切换到浅色主题' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await openChart(page);
      await page.getByRole('button', { name: '分时', exact: true }).click();
      await expect(metrics).toContainText('1325.75');
      await expectChartFits(page);
      await canvas.focus();
      await canvas.press('Home');
      await expect(metrics).toContainText('1305.10');
      await canvas.press('ArrowRight');
      await expect(metrics).toContainText('1301.25');
      await canvas.press('End');
      await expect(metrics).toContainText('1325.75');

      for (const [period, label] of [['day', '日K'], ['week', '周K'], ['month', '月K']] as const) {
        const data = klines(period).klines!;
        const tab = page.getByRole('button', { name: label, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-pressed', 'true');
        await expect(metrics).toContainText(data.at(-1)!.close.toFixed(2));
        await canvas.focus();
        await canvas.press('Home');
        await expect(metrics).toContainText(data[0].date);
        await expect(metrics).toContainText(data[0].close.toFixed(2));
        await canvas.press('ArrowRight');
        await expect(metrics).toContainText(data[1].date);
        await expect(metrics).toContainText(data[1].close.toFixed(2));
        await canvas.press('End');
        await expect(metrics).toContainText(data.at(-1)!.date);
        await expect(metrics).toContainText(data.at(-1)!.close.toFixed(2));
        await expectChartFits(page);
      }

      const accessibility = await new AxeBuilder({ page })
        .include('chart-detail-panel')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(accessibility.violations.filter((violation) =>
        violation.impact === 'critical' || violation.impact === 'serious'
      ), `chart accessibility in ${theme} theme`).toEqual([]);
      await page.getByRole('button', { name: '关闭详情面板' }).click();
      await expect(page.locator('chart-detail-panel')).toBeHidden();
    }
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});

test('a pending period survives Store rendering and its late result cannot replace the next period', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [{ ...stock(CODE), name: NAME }], boardConfig: gridBoardConfig() })
  });
  try {
    const { page } = launched;
    await installLoader(page, 'week');
    await openChart(page);
    const metrics = page.locator('[data-region="detail-metrics"]');
    await expect(metrics).toContainText('1325.75');
    const week = page.getByRole('button', { name: '周K', exact: true });
    await week.click();
    await expect(page.locator('[data-region="detail-status"]')).toContainText('加载');

    // Exercise the real AppShell -> Store -> stock-app view-model path while
    // chart loading is pending; do not directly call panel.viewModel/render.
    await page.locator('stock-app').evaluate((app) => app.dispatchEvent(new CustomEvent('theme-change', {
      detail: { theme: 'light' }, bubbles: true
    })));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(week).toHaveAttribute('aria-pressed', 'true');
    const month = page.getByRole('button', { name: '月K', exact: true });
    await month.click();
    await expect(metrics).toContainText('1523.75');
    await page.evaluate(async () => {
      const pending = (window as ChartHarness).__chartFixture.pending.week;
      if (!pending) throw new Error('weekly chart request was not deferred');
      pending();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    await expect(month).toHaveAttribute('aria-pressed', 'true');
    await expect(metrics).toContainText('1523.75');
    await expect(metrics).not.toContainText('1423.75');
    await expect(page.locator('[data-region="detail-status"]')).toBeHidden();
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});
