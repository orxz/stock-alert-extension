// tests/component/sparkline.test.ts
// v2.5.3 迷你走势公共模块：判色 / hexToRgba / drawSparkline 契约（canvas stub 下验证）。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { stubCanvas2d } from '../helpers/canvas-stub.js';
import {
  CHART_UP,
  CHART_DOWN,
  CHART_FLAT,
  hexToRgba,
  trendColorOf,
  drawSparkline
} from '../../src/popup/components/sparkline.js';

test('trendColorOf judges by sequence endpoints', () => {
  assert.equal(trendColorOf([0.2, 0.5, 0.9]), CHART_UP, '末点高 → 涨色');
  assert.equal(trendColorOf([0.9, 0.5, 0.2]), CHART_DOWN, '末点低 → 跌色');
  assert.equal(trendColorOf([0.3, 0.3]), CHART_FLAT, '平走 → 平色');
  assert.equal(trendColorOf([0.5]), CHART_FLAT, '过短 → 平色（不判色）');
  assert.equal(trendColorOf([]), CHART_FLAT);
});

test('hexToRgba converts hex with alpha', () => {
  assert.equal(hexToRgba('#ff5a5c', 0.5), 'rgba(255, 90, 92, 0.5)');
  assert.equal(hexToRgba('#16c79a', 1), 'rgba(22, 199, 154, 1)');
});

test('drawSparkline rejects short sequences and missing canvas', () => {
  resetDom();
  stubCanvas2d();
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  assert.equal(drawSparkline(null, [0.5, 0.6]), false, '无 canvas → false');
  assert.equal(drawSparkline(canvas, [0.5]), false, '单点 → false');
  assert.equal(drawSparkline(canvas, []), false, '空序列 → false');
});

test('drawSparkline sets physical resolution from container rect (fallback attr size)', () => {
  resetDom();
  stubCanvas2d();
  // happy-dom 的 getBoundingClientRect 返回 0 → 回退 canvas 属性宽高（36×18）。
  const canvas = document.createElement('canvas');
  canvas.width = 36;
  canvas.height = 18;
  document.body.append(canvas);
  const ok = drawSparkline(canvas, [0.1, 0.5, 0.3, 0.8]);
  assert.equal(ok, true);
  assert.equal(canvas.width, 36, '回退属性宽（dpr=1）');
  assert.equal(canvas.height, 18);
});

test('drawSparkline succeeds on a full sequence without throwing', () => {
  resetDom();
  stubCanvas2d();
  const canvas = document.createElement('canvas');
  canvas.width = 148;
  canvas.height = 36;
  document.body.append(canvas);
  const seq = Array.from({ length: 20 }, (_, i) => 0.5 + Math.sin(i / 3) * 0.3);
  assert.equal(drawSparkline(canvas, seq, { midline: true, fillTop: 0.25 }), true);
  // 平走 + midline：触及 0.5 的序列也正常（不抛错）。
  assert.equal(drawSparkline(canvas, [0.5, 0.5, 0.5], { midline: true }), true);
});

test('color constants match tokens (--up/--down)', () => {
  // 与 tokens.css 的 --up/--down 一致——canvas 读不到 CSS 变量，此为唯一副本的锚点断言。
  assert.equal(CHART_UP, '#ff5a5c');
  assert.equal(CHART_DOWN, '#16c79a');
  assert.equal(CHART_FLAT, '#8a8f98');
});

test('optional padding keeps extrema and endpoint markers inside the canvas', () => {
  resetDom();
  stubCanvas2d();
  const canvas = document.createElement('canvas');
  canvas.width = 280;
  canvas.height = 88;
  const ctx = canvas.getContext('2d')!;
  const coords: readonly number[][] = [];
  const points = coords as number[][];
  const marks: number[][] = [];
  const proxy = new Proxy(ctx, { get(target, key) {
    if (key === 'moveTo' || key === 'lineTo') return (x: number, y: number) => { points.push([x, y]); };
    if (key === 'fillRect') return (x: number, y: number, w: number, h: number) => { marks.push([x, y, w, h]); };
    return Reflect.get(target, key);
  } });
  Object.defineProperty(canvas, 'getContext', { value: () => proxy });
  assert.ok(drawSparkline(canvas, [0, 1, 0.5], { padding: 6, endPoint: true }));
  assert.ok(points.every(([x, y]) => x >= 6 && x <= 274 && y >= 6 && y <= 82), 'max/min curves must not be clipped');
  assert.equal(marks.length, 1, 'last actual price has a visible endpoint marker');
  const [x, y, w, h] = marks[0];
  assert.ok(x >= 0 && y >= 0 && x + w <= 280 && y + h <= 88);
});

test('hidden high-DPR redraws retain logical dimensions instead of multiplying the backing store', (t) => {
  resetDom();
  stubCanvas2d();
  const previousDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
  t.after(() => {
    if (previousDpr) Object.defineProperty(window, 'devicePixelRatio', previousDpr);
    else Reflect.deleteProperty(window, 'devicePixelRatio');
  });
  const canvas = document.createElement('canvas');
  let width = 280;
  let height = 88;
  Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ width, height }) });
  drawSparkline(canvas, [0, 0.5, 1]);
  assert.deepEqual([canvas.width, canvas.height], [560, 176]);
  width = 0; height = 0; // A display:none tooltip ancestor has no layout box.
  for (let i = 0; i < 10; i++) drawSparkline(canvas, [0, 0.5, 1]);
  assert.deepEqual([canvas.width, canvas.height], [560, 176], 'hidden quote updates must not grow the bitmap exponentially');
  width = 300; height = 100;
  drawSparkline(canvas, [0, 0.5, 1]);
  assert.deepEqual([canvas.width, canvas.height], [600, 200], 'the next visible layout still updates its real resolution');
});

test('an initially hidden index strip uses its original attribute size only once at high DPR', (t) => {
  resetDom();
  stubCanvas2d();
  const previousDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
  t.after(() => {
    if (previousDpr) Object.defineProperty(window, 'devicePixelRatio', previousDpr);
    else Reflect.deleteProperty(window, 'devicePixelRatio');
  });
  const canvas = document.createElement('canvas');
  canvas.width = 36;
  canvas.height = 18;
  for (let i = 0; i < 5; i++) drawSparkline(canvas, [0.5, 0.6]);
  assert.deepEqual([canvas.width, canvas.height], [72, 36]);
});
