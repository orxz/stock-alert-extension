// tests/component/chart-detail-panel.test.ts
// v2.2 详情面板：开关渲染 / 标题 / tab 切换 / loader 调用 / 错误态 / 关闭事件。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { stubCanvas2d } from '../helpers/canvas-stub.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import { ChartDetailPanelElement } from '../../src/popup/components/chart-detail-panel.js';
import { closedDetailPanel } from '../../src/popup/view-models.js';
import type { DetailPanelViewModel } from '../../src/popup/view-models.js';
import type { ChartData, TrendPoint, KlineBar } from '../../src/domain/index.js';

function makeTrends(): ChartData {
  return {
    code: 'sh600519',
    kind: 'trends',
    name: '贵州茅台',
    prevClose: 1304,
    trends: [
      { time: Date.parse('2026-08-26T09:30:00+08:00'), price: 1300, avgPrice: 1300, high: 1300, low: 1300, volume: 1, amount: 1, volumeRatio: 1 },
      { time: Date.parse('2026-08-26T09:31:00+08:00'), price: 1301, avgPrice: 1300.5, high: 1302, low: 1300, volume: 2, amount: 2, volumeRatio: 1.2 }
    ] as readonly TrendPoint[],
    fetchedAt: 0
  };
}

function panel(): ChartDetailPanelElement {
  definePopupElements();
  stubCanvas2d();
  const el = document.createElement('chart-detail-panel') as ChartDetailPanelElement;
  document.body.append(el);
  return el;
}

test('hidden by default, opens on viewModel with code', () => {
  resetDom();
  const el = panel();
  el.viewModel = closedDetailPanel();
  assert.ok(el.hasAttribute('hidden'));
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  assert.ok(!el.hasAttribute('hidden'));
  assert.match(el.querySelector('[data-region="detail-title"]')?.textContent ?? '', /贵州茅台/);
});

test('closes via detail-close-request event', () => {
  resetDom();
  const el = panel();
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  let closed = false;
  el.addEventListener('detail-close-request', () => { closed = true; });
  el.querySelector<HTMLButtonElement>('[data-action="detail-close"]')?.click();
  assert.ok(closed);
});

test('loader invoked on open with trends; tab switch calls kline', async () => {
  resetDom();
  const el = panel();
  const calls: string[] = [];
  el.setLoader(async (_code, kind, period) => {
    calls.push(`${kind}|${period}`);
    return kind === 'trends' ? makeTrends() : ({ code: 'sh600519', kind: 'kline', name: '贵州茅台', klines: [
      { date: '2026-08-25', open: 100, close: 101, high: 102, low: 99, volume: 1, amount: 1, changePercent: 1, turnoverRate: 1 }
    ] as readonly KlineBar[], fetchedAt: 0 } satisfies ChartData);
  });
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls, ['trends|day'], '打开即拉分时');

  const dayTab = el.querySelector<HTMLButtonElement>('[data-chart-key="day"]');
  dayTab?.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls[1], 'kline|day', '日K tab 拉 kline');
});

test('loader failure shows retry status and keeps panel open', async () => {
  resetDom();
  const el = panel();
  el.setLoader(async () => { throw new Error('offline'); });
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  await new Promise((r) => setTimeout(r, 20));
  const status = el.querySelector('[data-region="detail-status"]');
  assert.ok(status?.textContent?.includes('加载失败'), '错误态可见');
});

test('switch stock clears old data and reloads', async () => {
  resetDom();
  const el = panel();
  const calls: string[] = [];
  el.setLoader(async (code) => {
    calls.push(code);
    return makeTrends();
  });
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  await new Promise((r) => setTimeout(r, 20));
  el.viewModel = { open: true, code: 'sz399006', name: '创业板指' };
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls, ['sh600519', 'sz399006'], '换标的重拉');
});

test('closing hides panel', () => {
  resetDom();
  const el = panel();
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  el.viewModel = closedDetailPanel();
  assert.ok(el.hasAttribute('hidden'));
});

/** Record the real renderer's output through the shared canvas stub. */
function captureCanvas(el: ChartDetailPanelElement) {
  const canvas = el.querySelector('canvas')!;
  const context = canvas.getContext('2d')!;
  const text: { value: string; x: number; y: number; color: string | CanvasGradient | CanvasPattern }[] = [];
  const paths: { x: number; y: number }[] = [];
  const recorder = new Proxy(context, {
    get(target, key) {
      if (key === 'fillText') return (value: string, x: number, y: number) => text.push({ value, x, y, color: target.fillStyle });
      if (key === 'moveTo' || key === 'lineTo') return (x: number, y: number) => paths.push({ x, y });
      return Reflect.get(target, key);
    }
  });
  Object.defineProperty(canvas, 'getContext', { value: () => recorder });
  Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 400, height: 360 }) });
  return { canvas, text, paths };
}

const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };

function klineData(close = 102, date = '2026-08-26'): ChartData {
  return { code: 'sh600519', name: '贵州茅台', kind: 'kline', fetchedAt: 0, klines: [
    { date, open: close - 1, close, high: close + 1, low: close - 2, volume: 250, amount: 25000, changePercent: 1, turnoverRate: 1 }
  ] };
}

test('price labels increase upwards and match the plotted price direction', async () => {
  resetDom();
  const el = panel();
  const { text } = captureCanvas(el);
  el.setLoader(async () => makeTrends());
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  await settle();
  const axis = text.filter((entry) => entry.x > 30 && entry.x < 50 && Number(entry.value) > 0).sort((a, b) => a.y - b.y);
  assert.ok(axis.length >= 3, 'price axis must exist');
  assert.ok(Number(axis[0].value) > Number(axis.at(-1)!.value), 'top price must exceed bottom price');
});

test('gap-up trends keep the previous close and average within the price plot', async () => {
  resetDom();
  const el = panel();
  const { paths } = captureCanvas(el);
  const data = { ...makeTrends(), prevClose: 1280 };
  el.setLoader(async () => data);
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  await settle();
  assert.ok(paths.length > 0);
  assert.ok(paths.every((point) => Number.isFinite(point.y) && point.y >= 0 && point.y <= 360), 'gap fill cannot escape the canvas');
});

test('late chart responses cannot overwrite the selected period', async () => {
  resetDom();
  const el = panel();
  const { text } = captureCanvas(el);
  const pending: ((data: ChartData) => void)[] = [];
  el.setLoader(() => new Promise((resolve) => pending.push(resolve)));
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  el.querySelector<HTMLButtonElement>('[data-chart-key="week"]')!.click();
  pending[1](klineData(222));
  await settle();
  const selectedDrawing = JSON.stringify(text);
  pending[0](makeTrends());
  await settle();
  assert.equal(JSON.stringify(text), selectedDrawing, 'an obsolete response must not repaint the chart');
  assert.equal(el.querySelector('[data-chart-key="week"]')?.getAttribute('aria-pressed'), 'true');
});

test('retry control actually reloads and recovers the failed chart', async () => {
  resetDom();
  const el = panel();
  let failed = false;
  el.setLoader(async () => {
    if (!failed) { failed = true; throw new Error('offline'); }
    return makeTrends();
  });
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  await settle();
  const retry = el.querySelector<HTMLButtonElement>('[data-action="chart-retry"]');
  assert.ok(retry, 'failure offers a keyboard-accessible retry button');
  retry.click();
  await settle();
  assert.ok(el.querySelector('[data-region="detail-status"]')?.hasAttribute('hidden'));
  assert.match(el.querySelector('[data-region="detail-metrics"]')?.textContent ?? '', /1301\.00/);
});

test('trends use the full Shanghai trading session with a percentage axis', async () => {
  resetDom();
  const el = panel();
  const { text } = captureCanvas(el);
  el.setLoader(async () => makeTrends());
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  await settle();
  for (const label of ['09:30', '11:30/13:00', '15:00']) {
    assert.ok(text.some((entry) => entry.value === label), `session label ${label} is drawn even at 09:31`);
  }
  assert.ok(text.some((entry) => entry.value.endsWith('%')), 'percentage axis is shown against previous close');
});

test('single-candle keyboard inspection exposes exact OHLC without drawing a tooltip over the chart', async () => {
  resetDom();
  const el = panel();
  const { canvas, text } = captureCanvas(el);
  el.setLoader(async () => klineData(1301.98));
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  await settle();
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  const metrics = el.querySelector('[data-region="detail-metrics"]')!;
  assert.match(metrics.textContent ?? '', /1301\.98/);
  assert.match(metrics.textContent ?? '', /2026-08-26/);
  assert.ok(!text.some((entry) => /开.*收.*高.*低/.test(entry.value)), 'OHLC belongs in the wrapping DOM readout');
});

test('reapplying the same stock while loading does not reset the selected period', async () => {
  resetDom();
  const el = panel();
  el.setLoader(() => new Promise(() => {}));
  const vm: DetailPanelViewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  el.viewModel = vm;
  el.querySelector<HTMLButtonElement>('[data-chart-key="month"]')!.click();
  el.viewModel = vm;
  assert.equal(el.querySelector('[data-chart-key="month"]')?.getAttribute('aria-pressed'), 'true');
});

test('opening takes keyboard focus and closing restores the triggering control', () => {
  resetDom();
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const el = panel();
  el.addEventListener('detail-close-request', () => { el.viewModel = closedDetailPanel(); });
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  assert.ok(el.contains(document.activeElement), 'focus must move inside the visible panel');
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(el.hidden);
  assert.equal(document.activeElement, trigger);
});

test('pointer inspection follows actual trading-minute coordinates across missing minutes', async () => {
  resetDom();
  const el = panel();
  const { canvas } = captureCanvas(el);
  const first = makeTrends().trends![0];
  const trends = [
    first,
    { ...first, time: Date.parse('2026-08-26T09:31:00+08:00'), price: 1301 },
    { ...first, time: Date.parse('2026-08-26T10:30:00+08:00'), price: 1302 },
    { ...first, time: Date.parse('2026-08-26T13:00:00+08:00'), price: 1303 }
  ];
  el.setLoader(async () => ({ ...makeTrends(), trends }));
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  await settle();
  // 400px canvas: 50px axes, 300px plot. 10:30 is 60/240 trading minutes.
  canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 125, clientY: 80 }));
  assert.match(el.querySelector('.detail-readout-time')?.textContent ?? '', /10:30/);
  assert.match(el.querySelector('[data-region="detail-metrics"]')?.textContent ?? '', /1302\.00/);
  canvas.dispatchEvent(new MouseEvent('mouseleave'));
  assert.match(el.querySelector('.detail-readout-time')?.textContent ?? '', /13:00.*最新/);
});

test('a stale rejection cannot replace a newer successful chart with an error', async () => {
  resetDom();
  const el = panel();
  let rejectOld!: (reason: Error) => void;
  el.setLoader((_code, kind) => kind === 'trends' ? new Promise((_resolve, reject) => { rejectOld = reject; }) : Promise.resolve(klineData()));
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  el.querySelector<HTMLButtonElement>('[data-chart-key="day"]')!.click();
  await settle();
  rejectOld(new Error('late offline'));
  await settle();
  assert.ok(el.querySelector('[data-region="detail-status"]')?.hasAttribute('hidden'));
  assert.match(el.querySelector('[data-region="detail-metrics"]')?.textContent ?? '', /收盘102\.00/);
  assert.equal(el.getAttribute('aria-busy'), 'false');
});

test('empty data clears previous geometry and readouts without rendering invalid coordinates', async () => {
  resetDom();
  const el = panel();
  const { canvas, paths, text } = captureCanvas(el);
  el.setLoader(async (_code, kind) => kind === 'trends' ? makeTrends() : { ...klineData(), klines: [] });
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  await settle();
  el.querySelector<HTMLButtonElement>('[data-chart-key="day"]')!.click();
  await settle();
  canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 125 }));
  assert.equal(el.querySelector('[data-region="detail-metrics"]')?.textContent, '');
  assert.doesNotMatch(canvas.getAttribute('aria-label') ?? '', /1301\.00/, 'empty chart cannot announce stale prices');
  assert.ok(text.some((entry) => /暂无可用/.test(entry.value)));
  assert.ok(paths.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('moving averages use history before the visible 60 bars and suppress incomplete averages', async () => {
  resetDom();
  const el = panel();
  const { canvas } = captureCanvas(el);
  const bars = Array.from({ length: 65 }, (_, i) => ({ ...klineData(100 + i).klines![0], date: `2026-08-${String(i % 28 + 1).padStart(2, '0')}` }));
  el.setLoader(async () => ({ ...klineData(), klines: bars }));
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  await settle();
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  // First visible bar is index 5. Its MA5 uses closes 101,102,103,104,105 => 103.
  assert.match(el.querySelector('.detail-legend')?.textContent ?? '', /MA5 103\.00/);
  assert.match(el.querySelector('.detail-legend')?.textContent ?? '', /MA10 —/);
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.match(el.querySelector('.detail-legend')?.textContent ?? '', /MA20 154\.50/);
});

test('closing during load invalidates that response and reopening renders the fresh request', async () => {
  resetDom();
  const el = panel();
  const { text } = captureCanvas(el);
  const pending: ((data: ChartData) => void)[] = [];
  el.setLoader(() => new Promise((resolve) => pending.push(resolve)));
  const vm: DetailPanelViewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  el.viewModel = vm;
  el.viewModel = closedDetailPanel();
  const closedDrawing = JSON.stringify(text);
  pending[0](makeTrends());
  await settle();
  assert.equal(JSON.stringify(text), closedDrawing);
  el.viewModel = vm;
  pending[1](makeTrends());
  await settle();
  assert.match(el.querySelector('[data-region="detail-metrics"]')?.textContent ?? '', /1301\.00/);
});

test('chart percentages use the active theme up and down colors', async () => {
  resetDom();
  const el = panel();
  el.style.setProperty('--up', '#d22b30');
  el.style.setProperty('--down', '#05704c');
  const { text } = captureCanvas(el);
  el.setLoader(async () => makeTrends());
  el.viewModel = { open: true, code: 'sh600519', name: '贵州茅台' };
  await settle();
  assert.equal(text.find((entry) => entry.value.startsWith('+') && entry.value.endsWith('%'))?.color, '#d22b30');
  assert.equal(text.find((entry) => entry.value.startsWith('-') && entry.value.endsWith('%'))?.color, '#05704c');
});
