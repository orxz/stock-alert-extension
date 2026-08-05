import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { ColumnPanelViewModel } from '../../src/popup/view-models.js';
import { DEFAULT_UI_COLUMNS, type ColumnKey, type UiColumnPreferences } from '../../src/popup/ui-preferences.js';

function panel(columns: UiColumnPreferences = DEFAULT_UI_COLUMNS): ColumnPanelViewModel {
  return { columns };
}

function setup(vm: ColumnPanelViewModel = panel()): {
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
  el.viewModel = vm;
  return { el, spy };
}

function toggleCheckbox(columnKey: ColumnKey): void {
  const cb = document.querySelector(`input[data-column="${columnKey}"]`) as HTMLInputElement | null;
  if (!cb) throw new Error(`checkbox for ${columnKey} not found`);
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
}

function move(columnKey: ColumnKey, direction: 'col-up' | 'col-down'): void {
  const button = document.querySelector(
    `[data-column-item="${columnKey}"] button[data-action="${direction}"]`
  ) as HTMLButtonElement | null;
  if (!button) throw new Error(`${direction} for ${columnKey} not found`);
  button.click();
}

test('renders all versioned columns in preference order', () => {
  setup(panel({
    version: 1,
    enabled: ['name', 'price', 'changePercent'],
    order: ['status', 'amount', 'name', 'price', 'changePercent', 'code']
  }));

  assert.deepEqual(
    Array.from(document.querySelectorAll('[data-column-item]'), (item) => item.getAttribute('data-column-item')),
    ['status', 'amount', 'name', 'price', 'changePercent', 'code']
  );
});

test('checkbox state reflects enabled columns and required columns are disabled', () => {
  setup();
  assert.equal((document.querySelector('input[data-column="status"]') as HTMLInputElement).checked, true);
  for (const key of ['name', 'price', 'changePercent']) {
    assert.equal((document.querySelector(`input[data-column="${key}"]`) as HTMLInputElement).disabled, true);
  }
});

test('toggling an optional column emits one complete normalized column-settings-change', () => {
  const { spy } = setup();
  spy.reset();
  toggleCheckbox('status');

  assert.equal(spy.eventCount('column-settings-change'), 1);
  assert.equal(spy.eventCount('preferences-change'), 0);
  assert.deepEqual(spy.lastEvent('column-settings-change')?.detail.columns, {
    version: 1,
    enabled: ['name', 'code', 'price', 'changePercent', 'amount'],
    order: ['name', 'price', 'changePercent', 'amount', 'code', 'status']
  });
});

test('required columns cannot be unchecked', () => {
  const { spy } = setup();
  spy.reset();
  toggleCheckbox('price');

  assert.equal(spy.eventCount('column-settings-change'), 0);
  assert.equal((document.querySelector('input[data-column="price"]') as HTMLInputElement).checked, true);
});

test('moving a column emits the complete final order', () => {
  const { spy } = setup();
  spy.reset();
  move('amount', 'col-up');

  assert.deepEqual(spy.lastEvent('column-settings-change')?.detail.columns, {
    version: 1,
    enabled: ['name', 'code', 'status', 'price', 'changePercent', 'amount'],
    order: ['name', 'price', 'amount', 'changePercent', 'code', 'status']
  });
});

test('emitted enabled and order arrays are complete and duplicate-free', () => {
  const { spy } = setup();
  spy.reset();
  move('amount', 'col-down');
  const columns = spy.lastEvent('column-settings-change')?.detail.columns;
  assert.ok(columns);
  assert.equal(new Set(columns.enabled).size, columns.enabled.length);
  assert.equal(new Set(columns.order).size, columns.order.length);
  assert.equal(columns.order.length, 6);
});

test('first and last move controls are disabled', () => {
  setup();
  assert.equal((document.querySelector('[data-column-item="name"] button[data-action="col-up"]') as HTMLButtonElement).disabled, true);
  assert.equal((document.querySelector('[data-column-item="status"] button[data-action="col-down"]') as HTMLButtonElement).disabled, true);
});

test('controls have accessible labels', () => {
  setup();
  for (const control of document.querySelectorAll('input, button')) {
    assert.ok((control.getAttribute('aria-label') ?? '').trim().length > 0);
  }
});

test('updating viewModel re-renders checkbox states', () => {
  const { el } = setup();
  el.viewModel = panel({
    version: 1,
    enabled: ['name', 'price', 'changePercent'],
    order: ['name', 'price', 'changePercent', 'amount', 'code', 'status']
  });
  assert.equal((document.querySelector('input[data-column="code"]') as HTMLInputElement).checked, false);
  assert.equal((document.querySelector('input[data-column="price"]') as HTMLInputElement).checked, true);
});

test('reconnecting does not duplicate listeners', () => {
  const { el, spy } = setup();
  el.remove();
  document.body.querySelector('div')?.append(el);
  spy.reset();
  toggleCheckbox('status');
  assert.equal(spy.eventCount('column-settings-change'), 1);
});
