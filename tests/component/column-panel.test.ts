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
const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: 'code', label: '代码', enabled: true },
  { key: 'name', label: '名称', enabled: true },
  { key: 'price', label: '现价', enabled: true },
  { key: 'amount', label: '成交额', enabled: true },
  { key: 'changePercent', label: '涨跌幅', enabled: true },
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

test('required columns cannot be unchecked', () => {
  // 规则从「至少留一列」收紧为「名称/现价/涨跌幅必留」——
  // 只剩「状态」一列的列表不再是股票列表。
  for (const required of ['name', 'price', 'changePercent']) {
    const { spy } = setup(panel());
    spy.reset();
    toggleCheckbox(required);
    assert.equal(spy.eventCount('column-settings-change'), 0, `${required} must not emit`);
    const cb = document.querySelector(`input[data-column="${required}"]`) as HTMLInputElement;
    assert.equal(cb.checked, true, `${required} stays checked`);
  }
});

test('emitted column set is complete and duplicate-free', () => {
  const { spy } = setup(panel());
  spy.reset();
  toggleCheckbox('status');
  const detail = spy.lastEvent('column-settings-change')?.detail;
  const cols = detail!.columns.enabled;
  // No duplicates
  assert.equal(new Set(cols).size, cols.length);
  // All are valid column keys
  for (const c of cols) {
    assert.ok(DEFAULT_COLUMNS.some((dc) => dc.key === c));
  }
});

test('move up button emits columnOrder with the column moved up', () => {
  const { spy } = setup(panel());
  spy.reset();
  // Move 'price' (index 2) up → swaps with 'name' (index 1)
  const item = document.querySelector('[data-column-item="price"]');
  const upBtn = item?.querySelector('button[data-action="col-up"]') as HTMLButtonElement | null;
  if (upBtn) {
    upBtn.click();
    const detail = spy.lastEvent('column-settings-change')?.detail;
    assert.ok(detail);
    const order = detail!.columns.order;
    const idx = order.indexOf('price');
    // After moving up, price should be at idx 1, and name at idx 2
    assert.equal(order[idx + 1], 'name'); // name should now be after price
  }
});

test('move down button emits columnOrder with the column moved down', () => {
  const { spy } = setup(panel());
  spy.reset();
  // Move 'name' (index 1) down → swaps with 'price' (index 2)
  const item = document.querySelector('[data-column-item="name"]');
  const downBtn = item?.querySelector('button[data-action="col-down"]') as HTMLButtonElement | null;
  if (downBtn) {
    downBtn.click();
    const detail = spy.lastEvent('column-settings-change')?.detail;
    assert.ok(detail);
    const order = detail!.columns.order;
    const idx = order.indexOf('name');
    // After moving down, name should be at idx 2, and price at idx 1
    assert.equal(order[idx - 1], 'price'); // price should now be before name
  }
});

test('columnOrder is complete and duplicate-free', () => {
  const { spy } = setup(panel());
  spy.reset();
  const item = document.querySelector('[data-column-item="price"]');
  const upBtn = item?.querySelector('button[data-action="col-up"]') as HTMLButtonElement | null;
  if (upBtn) {
    upBtn.click();
    const order = spy.lastEvent('column-settings-change')?.detail.columns.order;
    assert.ok(order);
    assert.equal(new Set(order!).size, order!.length);
    assert.equal(order!.length, DEFAULT_COLUMNS.length);
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

test('updating viewModel re-renders checkbox states', () => {
  const { el } = setup(panel());
  el.viewModel = panel({
    columns: DEFAULT_COLUMNS.map((c) => ({ ...c, enabled: c.key === 'name' })),
    columnOrder: DEFAULT_COLUMNS.map((c) => c.key)
  });
  const nameCb = document.querySelector('input[data-column="name"]') as HTMLInputElement;
  const priceCb = document.querySelector('input[data-column="price"]') as HTMLInputElement;
  assert.equal(nameCb.checked, true);
  assert.equal(priceCb.checked, false);
});

test('reconnecting does not duplicate listeners', () => {
  const { el, spy } = setup(panel());
  el.remove();
  document.body.querySelector('div')?.append(el);
  spy.reset();
  toggleCheckbox('code');
  assert.equal(spy.eventCount('column-settings-change'), 1);
});
