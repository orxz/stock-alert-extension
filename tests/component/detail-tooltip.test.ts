// tests/component/detail-tooltip.test.ts
// 悬停详情浮层翻转判定：浮层下缘超出滚动容器可视区底部 → 加 is-flipped。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { applyTooltipFlip } from '../../src/popup/components/detail-tooltip.js';

/** 把元素的 getBoundingClientRect 钉死为指定 bottom。 */
function pinRect(el: Element, bottom: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ bottom, top: bottom - 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: 0, toJSON: () => ({}) })
  });
}

function setup(): { host: HTMLElement; viewport: HTMLElement } {
  resetDom();
  const viewport = document.createElement('div');
  document.body.append(viewport);
  const host = document.createElement('div');
  host.className = 'stock-table-row';
  const tooltip = document.createElement('div');
  tooltip.className = 'stock-detail-tooltip';
  host.append(tooltip);
  viewport.append(host);
  return { host, viewport };
}

test('flips when the tooltip bottom exceeds the viewport bottom', () => {
  const { host, viewport } = setup();
  pinRect(host.querySelector('.stock-detail-tooltip')!, 500);
  pinRect(viewport, 400);
  applyTooltipFlip(host, viewport);
  assert.equal(host.querySelector('.stock-detail-tooltip')?.classList.contains('is-flipped'), true);
});

test('stays unflipped when the tooltip fits inside the viewport', () => {
  const { host, viewport } = setup();
  pinRect(host.querySelector('.stock-detail-tooltip')!, 380);
  pinRect(viewport, 400);
  applyTooltipFlip(host, viewport);
  assert.equal(host.querySelector('.stock-detail-tooltip')?.classList.contains('is-flipped'), false);
});

test('removes is-flipped when the tooltip moves back into view', () => {
  const { host, viewport } = setup();
  pinRect(host.querySelector('.stock-detail-tooltip')!, 500);
  pinRect(viewport, 400);
  applyTooltipFlip(host, viewport);
  assert.equal(host.querySelector('.stock-detail-tooltip')?.classList.contains('is-flipped'), true);
  pinRect(host.querySelector('.stock-detail-tooltip')!, 350);
  applyTooltipFlip(host, viewport);
  assert.equal(host.querySelector('.stock-detail-tooltip')?.classList.contains('is-flipped'), false);
});

test('tolerates hosts without a tooltip', () => {
  const { host, viewport } = setup();
  host.querySelector('.stock-detail-tooltip')?.remove();
  assert.doesNotThrow(() => applyTooltipFlip(host, viewport));
});
