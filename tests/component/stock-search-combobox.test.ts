// tests/component/stock-search-combobox.test.ts
// Task 17 Step 1 — stock-search-combobox 组件测试。
// 覆盖：ARIA 属性、ArrowUp/Down 导航、Enter 选择、Escape 关闭、
// 300ms debounce、stale generation 拒绝、timer 清理、重连不重复。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { SearchComboboxViewModel } from '../../src/popup/view-models.js';
import type { StockCode, StockSearchResult } from '../../src/domain/index.js';

function makeResults(prefix: string, count: number): StockSearchResult[] {
  const results: StockSearchResult[] = [];
  for (let i = 0; i < count; i++) {
    results.push({
      code: `${prefix}${i}` as StockCode,
      name: `${prefix.toUpperCase()}-${i}`,
      pinyin: `${prefix}${i}`,
      tags: []
    });
  }
  return results;
}

function vmFor(generation: number, results?: StockSearchResult[], status?: SearchComboboxViewModel['status']): SearchComboboxViewModel {
  return {
    results: results ?? makeResults('g', 3),
    status: status ?? 'success',
    generation
  };
}

function pressKey(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function setup(vm?: SearchComboboxViewModel): {
  el: HTMLElement & { viewModel: SearchComboboxViewModel; input: HTMLInputElement | null };
  spy: PopupEventSpy;
  input: HTMLInputElement;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('stock-search-combobox') as HTMLElement & { viewModel: SearchComboboxViewModel; input: HTMLInputElement | null };
  container.append(el);
  if (vm) el.viewModel = vm;
  const input = el.querySelector('input[data-action="combobox-input"]') as HTMLInputElement;
  return { el, spy, input };
}

// ===== ARIA 属性 =====

test('input has role=combobox and aria-expanded', () => {
  const { input } = setup();
  assert.equal(input.getAttribute('role'), 'combobox');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
});

test('input has aria-controls pointing to listbox', () => {
  const { input } = setup();
  const controlsId = input.getAttribute('aria-controls');
  assert.ok(controlsId);
  const listbox = document.getElementById(controlsId!);
  assert.ok(listbox);
  assert.equal(listbox!.getAttribute('role'), 'listbox');
});

test('results have role=option and aria-selected', () => {
  const results = makeResults('sh', 3);
  setup(vmFor(1, results));
  const options = document.querySelectorAll('[role="option"]');
  assert.equal(options.length, 3);
  for (const opt of options) {
    assert.equal(opt.getAttribute('aria-selected'), 'false');
  }
});

test('ArrowDown activates first option', () => {
  const { input } = setup(vmFor(1, makeResults('sh', 3)));
  pressKey(input, 'ArrowDown');
  const options = document.querySelectorAll('[role="option"]');
  assert.equal(options[0].getAttribute('aria-selected'), 'true');
  assert.ok(options[0].classList.contains('is-active'));
});

// ===== Keyboard navigation =====

test('ArrowDown moves active option forward', () => {
  const { input } = setup(vmFor(1, makeResults('sh', 3)));
  pressKey(input, 'ArrowDown'); // -1 → 0
  pressKey(input, 'ArrowDown'); // 0 → 1
  const options = document.querySelectorAll('[role="option"]');
  assert.equal(options[1].getAttribute('aria-selected'), 'true');
});

test('ArrowUp moves active option backward and wraps', () => {
  const { input } = setup(vmFor(1, makeResults('sh', 3)));
  pressKey(input, 'ArrowUp'); // from -1 → wrap to last
  const options = document.querySelectorAll('[role="option"]');
  assert.equal(options[options.length - 1].getAttribute('aria-selected'), 'true');
});

test('Enter selects active option and emits stock-search-select', () => {
  const results = makeResults('sh', 3);
  const { spy, input } = setup(vmFor(1, results));
  spy.reset();
  pressKey(input, 'ArrowDown'); // activeIndex = 0
  pressKey(input, 'Enter');
  const evt = spy.lastEvent('stock-search-select');
  assert.ok(evt);
  assert.equal(evt!.detail.code, results[0].code);
  assert.equal(evt!.detail.name, results[0].name);
});

test('clicking an option selects it', () => {
  const results = makeResults('sh', 3);
  const { spy } = setup(vmFor(1, results));
  spy.reset();
  const options = document.querySelectorAll('[role="option"]');
  (options[2] as HTMLElement).click();
  const evt = spy.lastEvent('stock-search-select');
  assert.ok(evt);
  assert.equal(evt!.detail.code, results[2].code);
});

test('Escape closes the listbox', () => {
  const { input } = setup(vmFor(1, makeResults('sh', 3)));
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  pressKey(input, 'Escape');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
});

// ===== Stale generation rejection =====

test('combobox rejects stale results and commits active option', () => {
  const generation2 = makeResults('gen2', 2);
  const generation1 = makeResults('gen1', 2);
  const { spy, input } = setup();
  const box = input.closest('stock-search-combobox') as HTMLElement & { viewModel: SearchComboboxViewModel };
  // 先设 generation 2（最新）
  box.viewModel = { results: generation2, status: 'success', generation: 2 };
  // 再设 generation 1（更旧 → 应被拒绝）
  box.viewModel = { results: generation1, status: 'success', generation: 1 };
  spy.reset();
  pressKey(input, 'ArrowDown'); // -1 → 0
  pressKey(input, 'Enter');
  const evt = spy.lastEvent('stock-search-select');
  assert.ok(evt);
  assert.equal(evt!.detail.code, generation2[0].code, 'should commit gen2[0] since gen1 was rejected');
});

// ===== Debounce =====

test('input change triggers debounced search-keyword-change after 300ms', async () => {
  const { spy, input } = setup();
  spy.reset();
  input.value = '贵州茅台';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  // Immediately: no event yet (debounced)
  assert.equal(spy.eventCount('search-keyword-change'), 0);
  // After 300ms
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(spy.eventCount('search-keyword-change'), 1);
  assert.equal(spy.lastEvent('search-keyword-change')?.detail.keyword, '贵州茅台');
});

test('rapid input changes debounce to last value', async () => {
  const { spy, input } = setup();
  spy.reset();
  input.value = 'a';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.value = 'ab';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.value = 'abc';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(spy.eventCount('search-keyword-change'), 1, 'only one debounced event');
  assert.equal(spy.lastEvent('search-keyword-change')?.detail.keyword, 'abc');
});

// ===== Lifecycle / cleanup =====

test('disconnect clears debounce timer (no late event)', async () => {
  const { spy, input, el } = setup();
  spy.reset();
  input.value = 'test';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  el.remove(); // disconnect → timer cleared
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(spy.eventCount('search-keyword-change'), 0, 'timer cleaned up on disconnect');
});

test('reconnecting does not duplicate listeners', async () => {
  const { spy, input, el } = setup();
  el.remove();
  document.body.querySelector('div')?.append(el);
  spy.reset();
  input.value = 'xyz';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(spy.eventCount('search-keyword-change'), 1);
});

// ===== aria-activedescendant =====

test('aria-activedescendant tracks active option', () => {
  const { input } = setup(vmFor(1, makeResults('sh', 3)));
  // Initially no active option
  assert.equal(input.getAttribute('aria-activedescendant'), '');
  pressKey(input, 'ArrowDown');
  assert.equal(input.getAttribute('aria-activedescendant'), 'combobox-option-0');
  pressKey(input, 'ArrowDown');
  assert.equal(input.getAttribute('aria-activedescendant'), 'combobox-option-1');
});
