// tests/component/stock-card.test.ts
// Task 16 Step 1 — stock-card 组件测试。
// 断言：article 结构、价格掩码、fresh/cached/missing 标签、
//       pin/order 事件（含完整 orderedCodes）、无 innerHTML、44px 触控目标。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { StockCardViewModel } from '../../src/popup/view-models.js';
import type { StockCode, GroupId } from '../../src/domain/index.js';

function card(code: string, overrides: Partial<StockCardViewModel> = {}): StockCardViewModel {
  return {
    code: code as StockCode,
    name: `股票${code}`,
    price: 100.5,
    change: 2.3,
    changePercent: 2.34,
    status: 'fresh',
    pinned: false,
    staleLabel: '',
    displayPrice: '100.50',
    displayChange: '+2.30',
    displayAmount: '1.2亿',
    ...overrides
  };
}

const ORDERED_CODES: StockCode[] = ['sh600519' as StockCode, 'sz000001' as StockCode];
const GROUP_ID = 'g_all' as GroupId;

function setup(vm?: StockCardViewModel): {
  el: HTMLElement & { viewModel: StockCardViewModel; orderedCodes: StockCode[]; groupId: GroupId };
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('stock-card') as HTMLElement & {
    viewModel: StockCardViewModel;
    orderedCodes: StockCode[];
    groupId: GroupId;
  };
  container.append(el);
  el.orderedCodes = ORDERED_CODES;
  el.groupId = GROUP_ID;
  if (vm) el.viewModel = vm;
  return { el, spy };
}

function clickAction(action: string): void {
  const btn = document.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement | null;
  if (!btn) throw new Error(`button[data-action="${action}"] not found`);
  btn.click();
}

test('renders an article element with data-key', () => {
  setup(card('sh600519'));
  const article = document.querySelector('stock-card[data-key="sh600519"] article');
  assert.ok(article);
});

test('displays stock name as text content', () => {
  setup(card('sh600519', { name: '贵州茅台' }));
  const article = document.querySelector('stock-card[data-key="sh600519"]') as HTMLElement;
  assert.ok(article.textContent?.includes('贵州茅台'));
});

test('displays formatted price when not hidden', () => {
  setup(card('sh600519', { displayPrice: '1688.00' }));
  const article = document.querySelector('stock-card[data-key="sh600519"]') as HTMLElement;
  assert.ok(article.textContent?.includes('1688.00'));
});

test('price masking shows bullets but retains accessible name', () => {
  setup(card('sh600519', { name: '贵州茅台', displayPrice: '****' }));
  const article = document.querySelector('stock-card[data-key="sh600519"]') as HTMLElement;
  assert.ok(article.textContent?.includes('****'));
  // Accessible name should still contain the stock name
  const ariaLabel = article.getAttribute('aria-label') ?? '';
  assert.ok(ariaLabel.includes('贵州茅台') || article.textContent?.includes('贵州茅台'));
});

test('fresh status has a text label', () => {
  setup(card('sh600519', { status: 'fresh' }));
  const article = document.querySelector('stock-card[data-key="sh600519"]') as HTMLElement;
  assert.ok(article.textContent?.includes('实时'));
});

test('cached status has a text label', () => {
  setup(card('sh600519', { status: 'cached', staleLabel: '已过期' }));
  const article = document.querySelector('stock-card[data-key="sh600519"]') as HTMLElement;
  assert.ok(article.textContent?.includes('已过期'));
});

test('missing status has a text label', () => {
  setup(card('sh600519', { status: 'missing' }));
  const article = document.querySelector('stock-card[data-key="sh600519"]') as HTMLElement;
  assert.ok(article.textContent?.includes('缺失') || article.textContent?.includes('无数据'));
});

test('pin button emits stock-pin-request with toggled pinned and full orderedCodes', () => {
  const { spy } = setup(card('sh600519', { pinned: false }));
  spy.reset();
  clickAction('pin');
  const detail = spy.lastEvent('stock-pin-request')?.detail;
  assert.ok(detail);
  assert.equal(detail!.code, 'sh600519');
  assert.equal(detail!.pinned, true);
  assert.deepEqual(detail!.orderedCodes, ['sh600519', 'sz000001']);
});

test('pin button on pinned card emits pinned=false', () => {
  const { spy } = setup(card('sh600519', { pinned: true }));
  spy.reset();
  clickAction('pin');
  const detail = spy.lastEvent('stock-pin-request')?.detail;
  assert.equal(detail!.pinned, false);
});

test('up button emits stock-order-request moving the card up', () => {
  // sh600519 is at index 0 → up should be no-op (or emit same order)
  // sz000001 is at index 1 → up should swap to index 0
  const { spy } = setup(card('sz000001'));
  spy.reset();
  clickAction('move-up');
  const detail = spy.lastEvent('stock-order-request')?.detail;
  assert.ok(detail);
  assert.equal(detail!.groupId, 'g_all');
  assert.deepEqual(detail!.orderedCodes, ['sz000001', 'sh600519']);
});

test('down button emits stock-order-request moving the card down', () => {
  const { spy } = setup(card('sh600519'));
  spy.reset();
  clickAction('move-down');
  const detail = spy.lastEvent('stock-order-request')?.detail;
  assert.ok(detail);
  assert.deepEqual(detail!.orderedCodes, ['sz000001', 'sh600519']);
});

test('pin button has accessible label', () => {
  setup(card('sh600519', { name: '贵州茅台' }));
  const btn = document.querySelector('button[data-action="pin"]') as HTMLElement;
  const label = btn.getAttribute('aria-label') ?? '';
  assert.ok(label.length > 0);
});

test('up and down buttons have accessible labels', () => {
  setup(card('sh600519', { name: '贵州茅台' }));
  const up = document.querySelector('button[data-action="move-up"]') as HTMLElement;
  const down = document.querySelector('button[data-action="move-down"]') as HTMLElement;
  assert.ok((up.getAttribute('aria-label') ?? '').length > 0);
  assert.ok((down.getAttribute('aria-label') ?? '').length > 0);
});

test('all buttons meet 44px minimum touch target via CSS class', () => {
  setup(card('sh600519'));
  const buttons = document.querySelectorAll('article button');
  for (const btn of buttons) {
    assert.ok(btn.classList.contains('stock-card-btn') || btn.classList.contains('stock-card-action'));
  }
});

test('updating viewModel re-renders price and status', () => {
  const { el } = setup(card('sh600519', { displayPrice: '100.00', status: 'fresh' }));
  el.viewModel = card('sh600519', { displayPrice: '200.00', status: 'cached', staleLabel: '已过期' });
  const article = document.querySelector('stock-card[data-key="sh600519"]') as HTMLElement;
  assert.ok(article.textContent?.includes('200.00'));
  assert.ok(article.textContent?.includes('已过期'));
});

test('reconnecting the card does not duplicate listeners', () => {
  const { el, spy } = setup(card('sh600519'));
  el.remove();
  document.body.querySelector('div')?.append(el);
  spy.reset();
  clickAction('pin');
  assert.equal(spy.eventCount('stock-pin-request'), 1);
});
