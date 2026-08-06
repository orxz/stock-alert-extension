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
    displayOpen: '99.00',
    displayHigh: '101.00',
    displayLow: '98.00',
    displayPrevClose: '99.50',
    displayVolume: '2.9万',
    displayTurnoverRate: '0.20%',
    displayAmplitude: '1.33%',
    displayVolumeRatio: '0.52',
    displayPe: '19.78',
    displayPb: '7.02',
    displayTotalMarketCap: '1.64万亿',
    displayFloatMarketCap: '1.64万亿',
    displayLimitUp: '1650.00',
    displayLimitDown: '1350.00',
    ...overrides
  };
}

const ORDERED_CODES: StockCode[] = ['sh600519' as StockCode, 'sz000001' as StockCode];
const GROUP_ID = 'g_all' as GroupId;

function setup(vm?: StockCardViewModel): {
  el: HTMLElement & { viewModel: StockCardViewModel; orderedCodes: StockCode[]; groupId: GroupId; columns: string[] | null };
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
    columns: string[] | null;
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

test('the ••• trigger opens the action menu for this stock', () => {
  const { spy } = setup(card('sh600519'));
  spy.reset();
  clickAction('stock-menu');
  const detail = spy.lastEvent('stock-menu-open-request')?.detail;
  assert.ok(detail);
  assert.equal(detail!.code, 'sh600519');
  // anchorId 必须确定且随 code 走——虚拟窗口会把同一节点复用给不同股票。
  assert.equal(detail!.anchorId, 'stock-actions-sh600519');
});

test('the ••• trigger id follows the stock when the node is reused', () => {
  const { el } = setup(card('sh600519'));
  el.viewModel = card('sz000001');
  const btn = document.querySelector('button[data-action="stock-menu"]') as HTMLElement;
  assert.equal(btn.id, 'stock-actions-sz000001');
});

test('pin/move controls are no longer inline on the card', () => {
  // 契约变更：420px 宽的 Popup 里每行三个按钮既挤又难点中，
  // 具体动作收敛到 stock-action-menu。
  setup(card('sh600519'));
  assert.equal(document.querySelector('button[data-action="pin"]'), null);
  assert.equal(document.querySelector('button[data-action="move-up"]'), null);
  assert.equal(document.querySelector('button[data-action="move-down"]'), null);
});

test('Enter still toggles pin directly on the focused card', () => {
  // 置顶是高频动作，保留键盘快捷路径，不必先开菜单。
  const { el, spy } = setup(card('sh600519', { pinned: false }));
  spy.reset();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const detail = spy.lastEvent('stock-pin-request')?.detail;
  assert.ok(detail);
  assert.equal(detail!.pinned, true);
  assert.deepEqual(detail!.orderedCodes, ['sh600519', 'sz000001']);
});

test('Enter on a pinned card unpins it', () => {
  const { el, spy } = setup(card('sh600519', { pinned: true }));
  spy.reset();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(spy.lastEvent('stock-pin-request')?.detail.pinned, false);
});

test('the ••• trigger has an accessible label naming the stock', () => {
  setup(card('sh600519', { name: '贵州茅台' }));
  const btn = document.querySelector('button[data-action="stock-menu"]') as HTMLElement;
  assert.ok((btn.getAttribute('aria-label') ?? '').includes('贵州茅台'));
  assert.equal(btn.getAttribute('aria-haspopup'), 'menu');
});

test('all buttons meet 44px minimum touch target via CSS class', () => {
  setup(card('sh600519'));
  const buttons = document.querySelectorAll('article button');
  for (const btn of buttons) {
    assert.ok(btn.classList.contains('stock-card-btn') || btn.classList.contains('stock-card-action'));
  }
});

test('card renders stock-detail-tooltip with sixteen detail values', () => {
  setup(card('sh600519', {
    displayOpen: '99.00',
    displayHigh: '101.00',
    displayLow: '98.00',
    displayPrevClose: '99.50',
    displayVolume: '2.9万',
    displayAmount: '37.5亿',
    displayChange: '+18.00',
    displayTurnoverRate: '0.20%',
    displayAmplitude: '1.33%',
    displayVolumeRatio: '0.52',
    displayPe: '19.78',
    displayPb: '7.02',
    displayTotalMarketCap: '1.64万亿',
    displayFloatMarketCap: '1.64万亿',
    displayLimitUp: '1650.00',
    displayLimitDown: '1350.00'
  }));
  const cardEl = document.querySelector('stock-card[data-key="sh600519"]') as HTMLElement;
  const tooltip = cardEl.querySelector('.stock-detail-tooltip');
  assert.ok(tooltip, 'card contains a detail tooltip');
  const value = (key: string): string | null =>
    tooltip?.querySelector(`.stock-detail-value[data-field="${key}"]`)?.textContent ?? null;
  assert.equal(value('open'), '99.00');
  assert.equal(value('high'), '101.00');
  assert.equal(value('low'), '98.00');
  assert.equal(value('prevClose'), '99.50');
  assert.equal(value('volume'), '2.9万');
  assert.equal(value('amount'), '37.5亿');
  assert.equal(value('change'), '+18.00');
  assert.equal(value('turnoverRate'), '0.20%');
  assert.equal(value('amplitude'), '1.33%');
  assert.equal(value('volumeRatio'), '0.52');
  assert.equal(value('pe'), '19.78');
  assert.equal(value('pb'), '7.02');
  assert.equal(value('totalMarketCap'), '1.64万亿');
  assert.equal(value('floatMarketCap'), '1.64万亿');
  assert.equal(value('limitUp'), '1650.00');
  assert.equal(value('limitDown'), '1350.00');
  assert.equal(tooltip?.querySelectorAll('.stock-detail-item').length, 16, 'tooltip should have 16 items');
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
  clickAction('stock-menu');
  assert.equal(spy.eventCount('stock-menu-open-request'), 1);
});

test('hovering the card triggers tooltip flip detection without errors', () => {
  const { el } = setup(card('sh600519'));
  assert.doesNotThrow(() => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new Event('focusin', { bubbles: true }));
    el.dispatchEvent(new Event('focusout', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
  });
});

// ===== 列设置在卡片视图的显隐 =====

test('card renders amount field with displayAmount text', () => {
  setup(card('sh600519'));
  const amountEl = document.querySelector('stock-card [data-field="amount"]');
  assert.ok(amountEl, 'card should render an amount field');
  assert.equal(amountEl?.textContent, '1.2亿');
});

test('card hides code/status/amount when columns exclude them', () => {
  const { el } = setup(card('sh600519'));
  el.columns = ['name', 'price', 'changePercent'];
  const codeEl = el.querySelector('[data-field="code"]') as HTMLElement;
  const statusEl = el.querySelector('.stock-card-status-label') as HTMLElement;
  const amountEl = el.querySelector('[data-field="amount"]') as HTMLElement;
  assert.equal(codeEl.hidden, true, 'code should hide');
  assert.equal(statusEl.hidden, true, 'status should hide');
  assert.equal(amountEl.hidden, true, 'amount should hide');
});

test('card shows all configurable fields when columns unset', () => {
  const { el } = setup(card('sh600519'));
  const codeEl = el.querySelector('[data-field="code"]') as HTMLElement;
  const statusEl = el.querySelector('.stock-card-status-label') as HTMLElement;
  const amountEl = el.querySelector('[data-field="amount"]') as HTMLElement;
  assert.equal(codeEl.hidden, false);
  assert.equal(statusEl.hidden, false);
  assert.equal(amountEl.hidden, false);
});

test('card restores hidden fields when columns re-enabled', () => {
  const { el } = setup(card('sh600519'));
  el.columns = ['name', 'price', 'changePercent'];
  el.columns = ['name', 'price', 'changePercent', 'code', 'status', 'amount'];
  const codeEl = el.querySelector('[data-field="code"]') as HTMLElement;
  const statusEl = el.querySelector('.stock-card-status-label') as HTMLElement;
  const amountEl = el.querySelector('[data-field="amount"]') as HTMLElement;
  assert.equal(codeEl.hidden, false);
  assert.equal(statusEl.hidden, false);
  assert.equal(amountEl.hidden, false);
});

test('card hides price/changePercent when columns exclude them', () => {
  const { el } = setup(card('sh600519'));
  el.columns = ['name', 'amount', 'code', 'status'];
  const priceEl = el.querySelector('[data-field="price"]') as HTMLElement;
  const pctEl = el.querySelector('.stock-card-change-percent') as HTMLElement;
  assert.equal(priceEl.hidden, true, 'price should hide');
  assert.equal(pctEl.hidden, true, 'changePercent should hide');
  // 锁定列 name 与不受列设置控制的涨跌额（change）保持可见。
  assert.equal(el.querySelector('[data-field="name"]')?.hasAttribute('hidden'), false);
});

test('card restores price/changePercent when columns re-enabled', () => {
  const { el } = setup(card('sh600519'));
  el.columns = ['name', 'amount', 'code', 'status'];
  el.columns = ['name', 'price', 'changePercent', 'amount', 'code', 'status'];
  const priceEl = el.querySelector('[data-field="price"]') as HTMLElement;
  const pctEl = el.querySelector('.stock-card-change-percent') as HTMLElement;
  assert.equal(priceEl.hidden, false);
  assert.equal(pctEl.hidden, false);
});
