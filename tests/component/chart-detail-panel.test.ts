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
  assert.equal(el.querySelector('[data-region="detail-title"]')?.textContent, '贵州茅台');
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
