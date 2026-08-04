// tests/component/stock-header.test.ts
// Task 15 Step 1 — stock-header 组件测试。
// 断言：三个原生按钮（添加股票 / 多选 / 价格可见性）的语义事件、aria-pressed、disabled、标签。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { HeaderViewModel } from '../../src/popup/view-models.js';

function mkHeader(overrides: Partial<HeaderViewModel> = {}): HeaderViewModel {
  return {
    groupName: '全部',
    stockCount: 3,
    selectionMode: false,
    priceHidden: false,
    canAddStock: true,
    ...overrides
  };
}

function setup(vm?: HeaderViewModel): { el: HTMLElement & { viewModel: HeaderViewModel }; spy: PopupEventSpy } {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('stock-header') as HTMLElement & { viewModel: HeaderViewModel };
  container.append(el);
  if (vm) el.viewModel = vm;
  return { el, spy };
}

function clickAction(action: string): void {
  const btn = document.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement | null;
  if (!btn) throw new Error(`Button[data-action="${action}"] not found`);
  btn.click();
}

test('add-stock button emits dialog-open-request with kind add-stock', () => {
  const { spy } = setup(mkHeader());
  spy.reset();
  clickAction('add-stock');
  assert.deepEqual(spy.lastEvent('dialog-open-request')?.detail, { kind: 'add-stock' });
});

test('multiselect toggle emits selection-mode-change with the final enabled value (off→on)', () => {
  const { spy } = setup(mkHeader({ selectionMode: false }));
  spy.reset();
  clickAction('multiselect');
  assert.deepEqual(spy.lastEvent('selection-mode-change')?.detail, { enabled: true });
});

test('multiselect toggle emits selection-mode-change with the final enabled value (on→off)', () => {
  const { spy } = setup(mkHeader({ selectionMode: true }));
  spy.reset();
  clickAction('multiselect');
  assert.deepEqual(spy.lastEvent('selection-mode-change')?.detail, { enabled: false });
});

test('multiselect button reflects aria-pressed from selectionMode', () => {
  setup(mkHeader({ selectionMode: true }));
  const btn = document.querySelector('button[data-action="multiselect"]') as HTMLElement;
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
});

test('multiselect button aria-pressed is false when selectionMode is false', () => {
  setup(mkHeader({ selectionMode: false }));
  const btn = document.querySelector('button[data-action="multiselect"]') as HTMLElement;
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
});

test('price visibility toggle emits preferences-change with priceHidden true when currently visible', () => {
  const { spy } = setup(mkHeader({ priceHidden: false }));
  spy.reset();
  clickAction('price-visibility');
  assert.deepEqual(spy.lastEvent('preferences-change')?.detail, { patch: { priceHidden: true } });
});

test('price visibility toggle emits preferences-change with priceHidden false when currently hidden', () => {
  const { spy } = setup(mkHeader({ priceHidden: true }));
  spy.reset();
  clickAction('price-visibility');
  assert.deepEqual(spy.lastEvent('preferences-change')?.detail, { patch: { priceHidden: false } });
});

test('price visibility button reflects aria-pressed from priceHidden', () => {
  setup(mkHeader({ priceHidden: true }));
  const btn = document.querySelector('button[data-action="price-visibility"]') as HTMLElement;
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
});

test('header displays group name and stock count', () => {
  setup(mkHeader({ groupName: '科技股', stockCount: 12 }));
  const title = document.querySelector('[data-region="header-title"]');
  const text = title?.textContent ?? '';
  assert.ok(text.includes('科技股'), 'should contain group name');
  assert.ok(text.includes('12'), 'should contain stock count');
});

test('add-stock button is disabled when canAddStock is false', () => {
  setup(mkHeader({ canAddStock: false }));
  const btn = document.querySelector('button[data-action="add-stock"]') as HTMLButtonElement;
  assert.equal(btn.disabled, true);
});

test('add-stock button is enabled when canAddStock is true', () => {
  setup(mkHeader({ canAddStock: true }));
  const btn = document.querySelector('button[data-action="add-stock"]') as HTMLButtonElement;
  assert.equal(btn.disabled, false);
});

test('updating viewModel re-renders text and aria-pressed states', () => {
  const { el, spy } = setup(mkHeader({ selectionMode: false, priceHidden: false }));
  el.viewModel = mkHeader({ groupName: '金融', stockCount: 7, selectionMode: true, priceHidden: true });
  const title = document.querySelector('[data-region="header-title"]');
  assert.ok((title?.textContent ?? '').includes('金融'));
  const multiBtn = document.querySelector('button[data-action="multiselect"]') as HTMLElement;
  const priceBtn = document.querySelector('button[data-action="price-visibility"]') as HTMLElement;
  assert.equal(multiBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(priceBtn.getAttribute('aria-pressed'), 'true');
  // After toggling price on (now hidden), click should set priceHidden false
  spy.reset();
  clickAction('price-visibility');
  assert.deepEqual(spy.lastEvent('preferences-change')?.detail, { patch: { priceHidden: false } });
});

test('reconnecting the header does not duplicate listeners', () => {
  const { el, spy } = setup(mkHeader());
  el.remove();
  document.body.querySelector('div')?.append(el);
  spy.reset();
  clickAction('add-stock');
  assert.equal(spy.eventCount('dialog-open-request'), 1);
});

test('all header buttons have accessible labels (aria-label or text)', () => {
  setup(mkHeader());
  for (const action of ['add-stock', 'multiselect', 'price-visibility']) {
    const btn = document.querySelector(`button[data-action="${action}"]`) as HTMLElement;
    const label = btn.getAttribute('aria-label') ?? btn.textContent ?? '';
    assert.ok(label.trim().length > 0, `button[${action}] must have accessible text`);
  }
});
