// tests/component/stock-toolbar.test.ts
// Task 15 Step 1 — stock-toolbar 组件测试。
// 断言：排序 select（发出含 sortField+sortDirection 的 patch）、搜索 input、
//       grid/list 视图切换按钮、列设置按钮的语义事件与当前值反射。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { ToolbarViewModel } from '../../src/popup/view-models.js';

function mkToolbar(overrides: Partial<ToolbarViewModel> = {}): ToolbarViewModel {
  return {
    viewMode: 'list',
    sortField: 'manual',
    sortDirection: 'asc',
    priceHidden: false,
    searchKeyword: '',
    totalCount: 5,
    hasStocks: true,
    ...overrides
  };
}

function setup(vm?: ToolbarViewModel): {
  el: HTMLElement & { viewModel: ToolbarViewModel };
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('stock-toolbar') as HTMLElement & { viewModel: ToolbarViewModel };
  container.append(el);
  if (vm) el.viewModel = vm;
  return { el, spy };
}

function setSelectValue(action: string, value: string): void {
  const select = document.querySelector(`select[data-action="${action}"]`) as HTMLSelectElement | null;
  if (!select) throw new Error(`select[data-action="${action}"] not found`);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function typeSearch(text: string): void {
  const input = document.querySelector('input[data-action="search"]') as HTMLInputElement | null;
  if (!input) throw new Error('search input not found');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function clickButton(label: string): void {
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    if ((btn.textContent ?? '').trim() === label) {
      (btn as HTMLButtonElement).click();
      return;
    }
  }
  throw new Error(`Button with text "${label}" not found`);
}

function clickAction(action: string): void {
  const btn = document.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement | null;
  if (!btn) throw new Error(`button[data-action="${action}"] not found`);
  btn.click();
}

test('sort select reflects current sortField and sortDirection', () => {
  setup(mkToolbar({ sortField: 'price', sortDirection: 'desc' }));
  const select = document.querySelector('select[data-action="sort"]') as HTMLSelectElement;
  assert.ok(select.value.includes('price'));
  assert.ok(select.value.includes('desc'));
});

test('sort select change emits preferences-change with both sortField and sortDirection', () => {
  const { spy } = setup(mkToolbar({ sortField: 'manual', sortDirection: 'asc' }));
  spy.reset();
  setSelectValue('sort', 'name:desc');
  const detail = spy.lastEvent('preferences-change')?.detail;
  assert.ok(detail);
  assert.equal(detail!.patch.sortField, 'name');
  assert.equal(detail!.patch.sortDirection, 'desc');
});

test('search input reflects current searchKeyword', () => {
  setup(mkToolbar({ searchKeyword: '贵州茅台' }));
  const input = document.querySelector('input[data-action="search"]') as HTMLInputElement;
  assert.equal(input.value, '贵州茅台');
});

test('search input emits search-keyword-change with the final keyword', () => {
  const { spy } = setup(mkToolbar({ searchKeyword: '' }));
  spy.reset();
  typeSearch('银行');
  assert.deepEqual(spy.lastEvent('search-keyword-change')?.detail, { keyword: '银行' });
});

test('search input emits empty keyword when cleared', () => {
  const { spy } = setup(mkToolbar({ searchKeyword: '旧词' }));
  spy.reset();
  typeSearch('');
  assert.deepEqual(spy.lastEvent('search-keyword-change')?.detail, { keyword: '' });
});

test('view button emits a final preference value', () => {
  const { spy } = setup(mkToolbar({ viewMode: 'grid' }));
  spy.reset();
  clickButton('列表');
  assert.deepEqual(spy.lastEvent('view-mode-change')?.detail, { viewMode: 'list' });
});

test('clicking grid view button emits view-mode-change with grid', () => {
  const { spy } = setup(mkToolbar({ viewMode: 'list' }));
  spy.reset();
  clickButton('网格');
  assert.deepEqual(spy.lastEvent('view-mode-change')?.detail, { viewMode: 'grid' });
});

test('current view mode button reflects aria-pressed true', () => {
  setup(mkToolbar({ viewMode: 'list' }));
  const listBtn = document.querySelector('button[data-action="view-list"]') as HTMLElement;
  const gridBtn = document.querySelector('button[data-action="view-grid"]') as HTMLElement;
  assert.equal(listBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(gridBtn.getAttribute('aria-pressed'), 'false');
});

test('column settings button emits column-panel-open-request with its anchor id', () => {
  const { spy } = setup(mkToolbar());
  spy.reset();
  clickAction('column-settings');
  // detail 带触发按钮 id——popover 用它定位并在关闭时归还焦点。
  assert.deepEqual(spy.lastEvent('column-panel-open-request')?.detail, {
    anchorId: 'toolbar-column-settings'
  });
});

test('column settings button has accessible label', () => {
  setup(mkToolbar());
  const btn = document.querySelector('button[data-action="column-settings"]') as HTMLElement;
  const label = btn.getAttribute('aria-label') ?? btn.textContent ?? '';
  assert.ok(label.trim().length > 0);
});

test('sort select has an accessible label', () => {
  setup(mkToolbar());
  const select = document.querySelector('select[data-action="sort"]') as HTMLElement;
  const label = select.getAttribute('aria-label') ?? select.getAttribute('title') ?? '';
  assert.ok(label.trim().length > 0);
});

test('search input has an accessible label', () => {
  setup(mkToolbar());
  const input = document.querySelector('input[data-action="search"]') as HTMLElement;
  const label = input.getAttribute('aria-label') ?? input.getAttribute('placeholder') ?? '';
  assert.ok(label.trim().length > 0);
});

test('updating viewModel re-renders sort value and view mode', () => {
  const { el } = setup(mkToolbar({ sortField: 'manual', viewMode: 'list' }));
  el.viewModel = mkToolbar({ sortField: 'changePercent', sortDirection: 'desc', viewMode: 'grid' });
  const select = document.querySelector('select[data-action="sort"]') as HTMLSelectElement;
  assert.ok(select.value.includes('changePercent'));
  const gridBtn = document.querySelector('button[data-action="view-grid"]') as HTMLElement;
  assert.equal(gridBtn.getAttribute('aria-pressed'), 'true');
});

test('reconnecting the toolbar does not duplicate listeners', () => {
  const { el, spy } = setup(mkToolbar());
  el.remove();
  document.body.querySelector('div')?.append(el);
  spy.reset();
  clickAction('column-settings');
  assert.equal(spy.eventCount('column-panel-open-request'), 1);
});
