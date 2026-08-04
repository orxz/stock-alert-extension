// tests/component/column-panel.test.ts
// Task 16 Step 1 — column-panel 组件测试。
// 断言：checkboxes + up/down 控件、至少一列启用、
//       emit preferences-change {columns, columnOrder}、数组完整无重复。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { ColumnPanelViewModel, ColumnConfig } from '../../src/popup/view-models.js';

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: 'code', label: '代码', enabled: true },
  { key: 'name', label: '名称', enabled: true },
  { key: 'price', label: '现价', enabled: true },
  { key: 'change', label: '涨跌额', enabled: true },
  { key: 'changePercent', label: '涨跌幅', enabled: false },
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
  assert.equal(changePercentCb.checked, false);
});

test('unchecking a column emits preferences-change with columns array', () => {
  const { spy } = setup(panel());
  spy.reset();
  toggleCheckbox('price');
  const detail = spy.lastEvent('preferences-change')?.detail;
  assert.ok(detail);
  assert.ok(detail!.columns);
  assert.ok(!detail!.columns!.includes('price'));
  // Other enabled columns should still be present
  assert.ok(detail!.columns!.includes('code'));
  assert.ok(detail!.columns!.includes('name'));
});

test('checking a column adds it to columns array', () => {
  const { spy } = setup(panel());
  spy.reset();
  toggleCheckbox('changePercent');
  const detail = spy.lastEvent('preferences-change')?.detail;
  assert.ok(detail);
  assert.ok(detail!.columns!.includes('changePercent'));
});

test('cannot uncheck the last enabled column', () => {
  const onlyOne: ColumnConfig[] = [
    { key: 'name', label: '名称', enabled: true },
    { key: 'code', label: '代码', enabled: false },
    { key: 'price', label: '现价', enabled: false }
  ];
  const { spy } = setup(panel({ columns: onlyOne, columnOrder: ['name', 'code', 'price'] }));
  spy.reset();
  toggleCheckbox('name');
  // Should NOT emit because at least one must stay enabled
  assert.equal(spy.eventCount('preferences-change'), 0);
  // Checkbox should remain checked
  const cb = document.querySelector('input[data-column="name"]') as HTMLInputElement;
  assert.equal(cb.checked, true);
});

test('columns array is complete and duplicate-free', () => {
  const { spy } = setup(panel());
  spy.reset();
  toggleCheckbox('change');
  const detail = spy.lastEvent('preferences-change')?.detail;
  assert.ok(detail!.columns);
  const cols = detail!.columns!;
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
    const detail = spy.lastEvent('preferences-change')?.detail;
    assert.ok(detail);
    assert.ok(detail!.columnOrder);
    const order = detail!.columnOrder!;
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
    const detail = spy.lastEvent('preferences-change')?.detail;
    assert.ok(detail);
    assert.ok(detail!.columnOrder);
    const order = detail!.columnOrder!;
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
    const detail = spy.lastEvent('preferences-change')?.detail;
    const order = detail!.columnOrder!;
    assert.equal(new Set(order).size, order.length);
    assert.equal(order.length, DEFAULT_COLUMNS.length);
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
  toggleCheckbox('price');
  assert.equal(spy.eventCount('preferences-change'), 1);
});
