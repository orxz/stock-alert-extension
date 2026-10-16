import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { stubCanvas2d } from '../helpers/canvas-stub.js';
import type { TrendPoint } from '../../src/domain/chart.js';
import { createMiniTrends, renderMiniTrends, setMiniTrendsStatus } from '../../src/popup/components/mini-trends.js';

function points(count = 241): readonly TrendPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    time: Date.parse('2026-10-16T09:30:00+08:00') + (i > 120 ? i + 90 : i) * 60_000,
    price: 10 + i / 100 + (i === 37 ? 2 : 0), avgPrice: 10, high: 15, low: 9,
    volume: 100, amount: 10_000, volumeRatio: 1
  }));
}

function mount() {
  resetDom();
  stubCanvas2d();
  const wrap = createMiniTrends();
  document.body.append(wrap);
  return wrap;
}

/** Observe drawing operations using the common canvas stub, without a second mock implementation. */
function capture(wrap: HTMLElement) {
  const canvas = wrap.querySelector<HTMLCanvasElement>('canvas');
  assert.ok(canvas, 'mini chart needs a canvas');
  const ctx = canvas.getContext('2d')!;
  const strokes: { path: readonly number[][]; color: unknown }[] = [];
  let path: number[][] = [];
  let measuredVisible = false;
  const proxy = new Proxy(ctx, { get(target, key) {
    if (key === 'beginPath') return () => { path = []; };
    if (key === 'moveTo' || key === 'lineTo') return (x: number, y: number) => { path.push([x, y]); };
    if (key === 'stroke') return () => { strokes.push({ path: [...path], color: target.strokeStyle }); };
    return Reflect.get(target, key);
  } });
  Object.defineProperty(canvas, 'getContext', { value: () => proxy });
  Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => {
    measuredVisible = !wrap.hidden && !canvas.hidden;
    return { width: 280, height: 88 };
  } });
  return { canvas, strokes, visibleAtMeasurement: () => measuredVisible };
}

test('mini chart starts hidden and loading reveals a readable status', () => {
  const wrap = mount();
  assert.ok(wrap.hidden);
  setMiniTrendsStatus(wrap, 'loading');
  assert.equal(wrap.hidden, false);
  assert.equal(wrap.dataset.state, 'loading');
  assert.match(wrap.querySelector('.detail-mini-status')?.textContent ?? '', /分时加载中/);
});

test('mini chart preserves every minute and measures after becoming visible', () => {
  const wrap = mount();
  const { canvas, strokes, visibleAtMeasurement } = capture(wrap);
  const data = points();
  renderMiniTrends(wrap, data, { priceHidden: false });
  assert.ok(visibleAtMeasurement(), 'rendering a hidden fallback canvas makes its visible image blurry');
  assert.equal(wrap.dataset.state, 'ready');
  assert.equal(canvas.width, 280);
  assert.equal(canvas.height, 88);
  const curve = strokes[0].path;
  assert.equal(curve.length, data.length, 'a one-minute spike must not vanish through 20-point sampling');
  assert.ok(curve.every(([x, y]) => x >= 4 && x <= 276 && y >= 4 && y <= 84), 'extrema and endpoints stay inside the canvas');
  assert.equal(wrap.querySelector('[data-field="mini-price"]')?.textContent, '12.40');
  assert.equal(wrap.querySelector('[data-field="mini-start"]')?.textContent, '09:30');
  assert.equal(wrap.querySelector('[data-field="mini-end"]')?.textContent, '15:00');
});

test('hidden prices remain masked in both visible and accessible mini-chart readouts', () => {
  const wrap = mount();
  const { canvas } = capture(wrap);
  renderMiniTrends(wrap, points(2), { priceHidden: true });
  assert.equal(wrap.querySelector('[data-field="mini-price"]')?.textContent, '****');
  assert.doesNotMatch(wrap.textContent ?? '', /10\.01/);
  assert.doesNotMatch(canvas.getAttribute('aria-label') ?? '', /10\.01/);
  renderMiniTrends(wrap, points(2), { priceHidden: false });
  assert.equal(wrap.querySelector('[data-field="mini-price"]')?.textContent, '10.01');
});

test('loading error and empty states clear stale prices and charts', () => {
  const wrap = mount();
  const { canvas } = capture(wrap);
  renderMiniTrends(wrap, points(), { priceHidden: false });
  for (const [state, message] of [['loading', '分时加载中'], ['error', '分时加载失败，移开后重试'], ['empty', '暂无分时数据，移开后重试']] as const) {
    setMiniTrendsStatus(wrap, state);
    assert.equal(wrap.hidden, false);
    assert.ok(canvas.hidden);
    assert.equal(wrap.querySelector('[data-field="mini-start"]')?.parentElement?.hidden, false, 'loading and error retain the footer height');
    assert.equal(wrap.dataset.state, state);
    assert.ok(wrap.querySelector('.detail-mini-status')?.textContent?.includes(message));
    assert.doesNotMatch(wrap.textContent ?? '', /12\.40/);
  }
});

test('mini chart uses the current theme color and exposes no invented previous-close reference', () => {
  const wrap = mount();
  wrap.style.setProperty('--up', '#d22b30');
  const { strokes } = capture(wrap);
  renderMiniTrends(wrap, points(), { priceHidden: false });
  assert.equal(strokes[0].color, '#d22b30');
  assert.equal(strokes.length, 1, 'there is no false previous-close line based on normalized midpoint');
  assert.doesNotMatch(wrap.textContent ?? '', /昨收/);
});

test('empty invalid and single-point data show an explicit empty state', () => {
  const wrap = mount();
  capture(wrap);
  for (const data of [[], points(1), [{ ...points(2)[0], price: Number.NaN }, points(2)[1]]]) {
    renderMiniTrends(wrap, data, { priceHidden: false });
    assert.equal(wrap.dataset.state, 'empty');
    assert.match(wrap.textContent ?? '', /暂无分时数据/);
  }
});

test('flat and falling series remain drawable and reflect their actual direction', () => {
  const wrap = mount();
  wrap.style.setProperty('--down', '#05704c');
  wrap.style.setProperty('--text-3', '#666666');
  const { strokes } = capture(wrap);
  renderMiniTrends(wrap, [...points(2)].reverse(), { priceHidden: false });
  assert.equal(strokes.at(-1)?.color, '#05704c');
  renderMiniTrends(wrap, points(3).map((point) => ({ ...point, price: 10 })), { priceHidden: false });
  assert.equal(strokes.at(-1)?.color, '#666666');
  assert.equal(new Set(strokes.at(-1)!.path.map(([, y]) => y)).size, 1);
});
