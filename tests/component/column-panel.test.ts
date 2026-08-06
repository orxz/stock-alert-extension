// tests/component/column-panel.test.ts
// Task 16 Step 1 — column-panel 组件测试。
// 断言：checkboxes + up/down 控件、必需列不可关闭、
//       emit column-settings-change（完整最终态）、集合完整无重复。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { ColumnPanelViewModel, ColumnConfig } from '../../src/popup/view-models.js';

// 必须是真实的可配置列键——normalizeUiColumns 会丢弃未知列。
// name 是锁定列（列表最前、不进面板），面板只展示可配置列。
const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: 'price', label: '现价', enabled: true },
  { key: 'changePercent', label: '涨跌幅', enabled: true },
  { key: 'amount', label: '成交额', enabled: true },
  { key: 'code', label: '代码', enabled: true },
  { key: 'status', label: '状态', enabled: true }
];

function panel(overrides: Partial<ColumnPanelViewModel> = {}): ColumnPanelViewModel {
  return {
    columns: DEFAULT_COLUMNS,
    columnOrder: DEFAULT_COLUMNS.map((c) => c.key),
    ...overrides
  };
}

function setup(vm?: ColumnPanelViewModel): {
  el: HTMLElement & { viewModel: ColumnPanelViewModel };
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('column-panel') as HTMLElement & { viewModel: ColumnPanelViewModel };
  container.append(el);
  if (vm) el.viewModel = vm;
  return { el, spy };
}

function toggleCheckbox(columnKey: string): void {
  const cb = document.querySelector(`input[data-column="${columnKey}"]`) as HTMLInputElement | null;
  if (!cb) throw new Error(`checkbox for ${columnKey} not found`);
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
}

function clickColumnAction(columnKey: string, action: string): void {
  const btn = document.querySelector(
    `[data-column="${columnKey}"] button[data-action="${action}"], button[data-column="${columnKey}"][data-action="${action}"]`
  ) as HTMLButtonElement | null;
  if (!btn) throw new Error(`button ${action} for ${columnKey} not found`);
  btn.click();
}

test('renders a checkbox for each column', () => {
  setup(panel());
  const checkboxes = document.querySelectorAll('input[type="checkbox"][data-column]');
  assert.equal(checkboxes.length, DEFAULT_COLUMNS.length);
});

test('checkbox checked state reflects enabled', () => {
  setup(panel());
  const priceCb = document.querySelector('input[data-column="price"]') as HTMLInputElement;
  assert.equal(priceCb.checked, true);
  const changePercentCb = document.querySelector('input[data-column="changePercent"]') as HTMLInputElement;
  assert.equal(changePercentCb.checked, true);
});

test('unchecking an optional column emits the full new column state', () => {
  const { spy } = setup(panel());
  spy.reset();
  toggleCheckbox('code');
  const detail = spy.lastEvent('column-settings-change')?.detail;
  assert.ok(detail);
  assert.ok(!detail!.columns.enabled.includes('code'));
  // 必需列必须仍在
  assert.ok(detail!.columns.enabled.includes('name'));
  assert.ok(detail!.columns.enabled.includes('price'));
});

test('re-checking a column adds it back', () => {
  const { spy } = setup(panel({
    columns: DEFAULT_COLUMNS.map((c) => (c.key === 'amount' ? { ...c, enabled: false } : c))
  }));
  spy.reset();
  toggleCheckbox('amount');
  const detail = spy.lastEvent('column-settings-change')?.detail;
  assert.ok(detail!.columns.enabled.includes('amount'));
});

test('the locked name column is not rendered in the panel', () => {
  setup(panel());
  assert.equal(document.querySelectorAll('.column-panel-item').length, 5);
  assert.equal(document.querySelector('input[data-column="name"]'), null, 'name must not appear in the panel');
});

test('price can be unchecked without being forced back', () => {
  const { spy } = setup(panel());
  spy.reset();
  toggleCheckbox('price');
  const detail = spy.lastEvent('column-settings-change')?.detail;
  assert.ok(detail, 'unchecking price must emit');
  assert.ok(!detail!.columns.enabled.includes('price'), 'price stays off');
  const cb = document.querySelector('input[data-column="price"]') as HTMLInputElement;
  assert.equal(cb.checked, false, 'checkbox stays unchecked');
});

test('emitted column set is complete and duplicate-free', () => {
  const { spy } = setup(panel());
  spy.reset();
  toggleCheckbox('status');
  const detail = spy.lastEvent('column-settings-change')?.detail;
  const cols = detail!.columns.enabled;
  // No duplicates
  assert.equal(new Set(cols).size, cols.length);
  // All are valid column keys（含锁定列 name——normalize 强制前置）
  const allKeys = ['name', ...DEFAULT_COLUMNS.map((c) => c.key)];
  for (const c of cols) {
    assert.ok(allKeys.includes(c));
  }
});

test('move up button emits columnOrder with the column moved up', () => {
  const { spy } = setup(panel());
  spy.reset();
  // Move 'amount' (index 2) up → swaps with 'changePercent' (index 1)
  const item = document.querySelector('[data-column-item="amount"]');
  const upBtn = item?.querySelector('button[data-action="col-up"]') as HTMLButtonElement | null;
  if (upBtn) {
    upBtn.click();
    const detail = spy.lastEvent('column-settings-change')?.detail;
    assert.ok(detail);
    const order = detail!.columns.order as string[];
    assert.equal(order[0], 'name', 'locked name column stays pinned first');
    const idx = order.indexOf('amount');
    assert.equal(order[idx - 1], 'price');
    assert.equal(order[idx + 1], 'changePercent', 'amount swapped with changePercent');
  }
});

test('move down button emits columnOrder with the column moved down', () => {
  const { spy } = setup(panel());
  spy.reset();
  // Move 'price' (index 0) down → swaps with 'changePercent' (index 1)
  const item = document.querySelector('[data-column-item="price"]');
  const downBtn = item?.querySelector('button[data-action="col-down"]') as HTMLButtonElement | null;
  if (downBtn) {
    downBtn.click();
    const detail = spy.lastEvent('column-settings-change')?.detail;
    assert.ok(detail);
    const order = detail!.columns.order as string[];
    assert.equal(order[0], 'name', 'locked name column stays pinned first');
    assert.equal(order[1], 'changePercent');
    assert.equal(order[2], 'price');
  }
});

test('columnOrder is complete and duplicate-free', () => {
  const { spy } = setup(panel());
  spy.reset();
  const item = document.querySelector('[data-column-item="amount"]');
  const upBtn = item?.querySelector('button[data-action="col-up"]') as HTMLButtonElement | null;
  if (upBtn) {
    upBtn.click();
    const order = spy.lastEvent('column-settings-change')?.detail.columns.order;
    assert.ok(order);
    assert.equal(new Set(order!).size, order!.length);
    // 锁定列前置后仍是完整 6 列排列。
    assert.equal(order!.length, DEFAULT_COLUMNS.length + 1);
    assert.equal(order![0], 'name');
  }
});

test('up/down buttons have accessible labels', () => {
  setup(panel());
  const upBtns = document.querySelectorAll('button[data-action="col-up"]');
  const downBtns = document.querySelectorAll('button[data-action="col-down"]');
  for (const btn of upBtns) {
    const label = (btn as HTMLElement).getAttribute('aria-label') ?? '';
    assert.ok(label.length > 0);
  }
  for (const btn of downBtns) {
    const label = (btn as HTMLElement).getAttribute('aria-label') ?? '';
    assert.ok(label.length > 0);
  }
});

test('checkboxes have accessible labels', () => {
  setup(panel());
  const checkboxes = document.querySelectorAll('input[type="checkbox"][data-column]');
  for (const cb of checkboxes) {
    const label = (cb as HTMLElement).getAttribute('aria-label')
      ?? (cb as HTMLElement).getAttribute('title')
      ?? cb.closest('label')?.textContent ?? '';
    assert.ok(label.trim().length > 0);
  }
});

test('first column move-up is disabled', () => {
  setup(panel());
  const firstItem = document.querySelector('[data-column-item="code"]');
  const upBtn = firstItem?.querySelector('button[data-action="col-up"]') as HTMLButtonElement;
  assert.equal(upBtn.disabled, true);
});

test('last column move-down is disabled', () => {
  setup(panel());
  const items = document.querySelectorAll('[data-column-item]');
  const lastItem = items[items.length - 1];
  const downBtn = lastItem.querySelector('button[data-action="col-down"]') as HTMLButtonElement;
  assert.equal(downBtn.disabled, true);
});

test('the last main column cannot move down into the subline zone', () => {
  // 工厂顺序 [price, changePercent, amount, code, status]：amount 是最后一个主列，
  // 它的 ↓ 若可用会与 code 交换——但副标题不参与重排，交换结果瞬间弹回原位。
  setup(panel());
  const item = document.querySelector('[data-column-item="amount"]');
  const downBtn = item?.querySelector('button[data-action="col-down"]') as HTMLButtonElement | null;
  assert.equal(downBtn?.disabled, true, '主列不得跨入副标题区');
});

test('updating viewModel re-renders checkbox states', () => {
  const { el } = setup(panel());
  el.viewModel = panel({
    columns: DEFAULT_COLUMNS.map((c) => ({ ...c, enabled: c.key === 'price' })),
    columnOrder: DEFAULT_COLUMNS.map((c) => c.key)
  });
  const priceCb = document.querySelector('input[data-column="price"]') as HTMLInputElement;
  const amountCb = document.querySelector('input[data-column="amount"]') as HTMLInputElement;
  assert.equal(priceCb.checked, true);
  assert.equal(amountCb.checked, false);
});

test('reconnecting does not duplicate listeners', () => {
  const { el, spy } = setup(panel());
  el.remove();
  document.body.querySelector('div')?.append(el);
  spy.reset();
  toggleCheckbox('code');
  assert.equal(spy.eventCount('column-settings-change'), 1);
});

test('subline columns (code/status) have ordering buttons disabled', () => {
  setup(panel());
  for (const key of ['code', 'status']) {
    const item = document.querySelector(`[data-column-item="${key}"]`);
    const upBtn = item?.querySelector('button[data-action="col-up"]') as HTMLButtonElement | null;
    const downBtn = item?.querySelector('button[data-action="col-down"]') as HTMLButtonElement | null;
    assert.equal(upBtn?.disabled, true, `${key} move-up should be disabled`);
    assert.equal(downBtn?.disabled, true, `${key} move-down should be disabled`);
  }
});

test('subline columns are marked with the subline class', () => {
  setup(panel());
  for (const key of ['code', 'status']) {
    const item = document.querySelector(`[data-column-item="${key}"]`);
    assert.ok(item?.classList.contains('column-panel-item--subline'), `${key} should be subline`);
  }
  const nameItem = document.querySelector('[data-column-item="name"]');
  assert.ok(!nameItem?.classList.contains('column-panel-item--subline'));
});

test('disabled subline ordering buttons emit no changes', () => {
  const { spy } = setup(panel());
  spy.reset();
  // 浏览器对 disabled 按钮不派发 click；即使被派发，组件也应防御性地忽略。
  const item = document.querySelector('[data-column-item="code"]');
  const upBtn = item?.querySelector('button[data-action="col-up"]') as HTMLButtonElement | null;
  upBtn?.click();
  assert.equal(spy.eventCount('column-settings-change'), 0);
});
