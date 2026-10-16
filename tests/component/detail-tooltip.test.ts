import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { applyTooltipFlip, clearTooltipPosition, tooltipNeedsFlip } from '../../src/popup/components/detail-tooltip.js';

type Rect = { left: number; top: number; width: number; height: number };

function pinRect(el: Element, rectangle: Rect | (() => Rect)): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const rect = typeof rectangle === 'function' ? rectangle() : rectangle;
      return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) };
    }
  });
}

function setup(hostRect: Rect = { left: 20, top: 100, width: 180, height: 40 }, height = 280): {
  app: HTMLElement; host: HTMLElement; viewport: HTMLElement; tooltip: HTMLElement;
} {
  resetDom();
  const app = document.createElement('stock-app');
  pinRect(app, { left: 0, top: 0, width: 420, height: 560 });
  document.body.append(app);
  const viewport = document.createElement('stock-board');
  pinRect(viewport, { left: 0, top: 180, width: 420, height: 320 });
  app.append(viewport);
  const host = document.createElement('div');
  host.className = 'stock-table-row';
  pinRect(host, hostRect);
  const tooltip = document.createElement('div');
  tooltip.className = 'stock-detail-tooltip';
  // The rect follows positioning writes: repeated calls exercise the old flip/unflip feedback loop.
  pinRect(tooltip, () => ({
    left: Number.parseFloat(tooltip.style.left) || hostRect.left,
    top: Number.parseFloat(tooltip.style.top) || hostRect.top + hostRect.height + 4,
    width: 304,
    height
  }));
  host.append(tooltip);
  viewport.append(host);
  return { app, host, viewport, tooltip };
}

test('positions a tooltip below its host within the popup instead of the board clipping edge', () => {
  const { host, viewport, tooltip } = setup({ left: 20, top: 210, width: 180, height: 40 });
  applyTooltipFlip(host, viewport);
  assert.equal(tooltip.style.left, '20px');
  assert.equal(tooltip.style.top, '254px');
  assert.equal(tooltip.classList.contains('is-flipped'), false);
  assert.equal(tooltipNeedsFlip(tooltip, viewport), false);
});

test('right and left edge tooltips stay within the popup horizontal bounds', () => {
  for (const [left, expected] of [[214, 108], [-30, 8]]) {
    const { host, viewport, tooltip } = setup({ left, top: 100, width: 190, height: 40 });
    applyTooltipFlip(host, viewport);
    assert.equal(tooltip.style.left, `${expected}px`);
  }
});

test('bottom tooltip flips above the host and keeps its direction on repeated positioning', () => {
  const { host, viewport, tooltip } = setup({ left: 214, top: 480, width: 190, height: 40 });
  for (let i = 0; i < 3; i++) {
    applyTooltipFlip(host, viewport);
    assert.equal(tooltip.style.top, '196px');
    assert.equal(tooltip.style.left, '108px');
    assert.equal(tooltip.classList.contains('is-flipped'), true);
    assert.equal(tooltipNeedsFlip(tooltip, viewport), true);
  }
});

test('when neither side fits the tooltip is clamped inside the popup', () => {
  const { host, viewport, tooltip } = setup({ left: 20, top: 250, width: 180, height: 40 }, 300);
  applyTooltipFlip(host, viewport);
  assert.equal(tooltip.style.top, '252px');
  assert.equal(tooltip.classList.contains('is-flipped'), false);
});

test('top boundary keeps a tooltip inside the popup padding', () => {
  const { host, viewport, tooltip } = setup({ left: 20, top: -40, width: 180, height: 40 });
  applyTooltipFlip(host, viewport);
  assert.equal(tooltip.style.top, '8px');
});

test('async mini-chart growth recomputes placement from host geometry', () => {
  const { host, viewport, tooltip } = setup({ left: 214, top: 320, width: 190, height: 40 }, 160);
  applyTooltipFlip(host, viewport);
  assert.equal(tooltip.style.top, '364px');
  pinRect(tooltip, { left: 108, top: 364, width: 304, height: 280 });
  applyTooltipFlip(host, viewport);
  assert.equal(tooltip.style.top, '36px');
  assert.equal(tooltip.classList.contains('is-flipped'), true);
});

test('popup bounds include its document offset', () => {
  const { app, host, viewport, tooltip } = setup({ left: 400, top: 150, width: 60, height: 40 });
  pinRect(app, { left: 50, top: 20, width: 420, height: 560 });
  applyTooltipFlip(host, viewport);
  assert.equal(tooltip.style.left, '158px');
  assert.equal(tooltip.style.top, '194px');
});

test('document viewport limits a popup that extends offscreen', () => {
  const { app, host, viewport, tooltip } = setup({ left: window.innerWidth - 80, top: 100, width: 60, height: 40 });
  pinRect(app, { left: window.innerWidth - 360, top: 0, width: 420, height: 560 });
  applyTooltipFlip(host, viewport);
  assert.equal(tooltip.style.left, `${window.innerWidth - 312}px`);
});

test('without a popup ancestor placement falls back to the document viewport', () => {
  const { host, viewport, tooltip } = setup({ left: window.innerWidth - 80, top: 100, width: 60, height: 40 });
  document.body.append(viewport);
  applyTooltipFlip(host, viewport);
  assert.equal(tooltip.style.left, `${window.innerWidth - 312}px`);
});

test('oversized tooltip receives dimensions constrained to the popup', () => {
  const { host, viewport, tooltip } = setup();
  pinRect(tooltip, { left: 20, top: 144, width: 600, height: 800 });
  applyTooltipFlip(host, viewport);
  assert.equal(tooltip.style.maxWidth, '404px');
  assert.equal(tooltip.style.maxHeight, '544px');
  assert.equal(tooltip.style.left, '8px');
  assert.equal(tooltip.style.top, '8px');
});

test('clearing removes fixed coordinates and direction before a host is reused', () => {
  const { host, viewport, tooltip } = setup({ left: 214, top: 480, width: 190, height: 40 });
  applyTooltipFlip(host, viewport);
  clearTooltipPosition(host);
  assert.equal(tooltip.classList.contains('is-flipped'), false);
  assert.equal(tooltip.style.left, '');
  assert.equal(tooltip.style.top, '');
  assert.equal(tooltip.style.maxWidth, '');
  assert.equal(tooltip.style.maxHeight, '');
});

test('tolerates hosts without a tooltip', () => {
  const { host, viewport, tooltip } = setup();
  tooltip.remove();
  assert.doesNotThrow(() => applyTooltipFlip(host, viewport));
  assert.doesNotThrow(() => clearTooltipPosition(host));
});
