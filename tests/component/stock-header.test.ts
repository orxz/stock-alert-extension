// tests/component/stock-header.test.ts
// Task 15 Step 1 — stock-header 组件测试。
// 断言：三个原生按钮（添加股票 / 主题切换 / 价格可见性）的语义事件、aria-pressed、disabled、标签。
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
    priceHidden: false,
    canAddStock: true,
    theme: 'dark',
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
  const { el, spy } = setup(mkHeader({ priceHidden: false }));
  el.viewModel = mkHeader({ groupName: '金融', stockCount: 7, priceHidden: true });
  const title = document.querySelector('[data-region="header-title"]');
  assert.ok((title?.textContent ?? '').includes('金融'));
  const priceBtn = document.querySelector('button[data-action="price-visibility"]') as HTMLElement;
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
  for (const action of ['theme-toggle', 'add-stock', 'price-visibility']) {
    const btn = document.querySelector(`button[data-action="${action}"]`) as HTMLElement;
    const label = btn.getAttribute('aria-label') ?? btn.textContent ?? '';
    assert.ok(label.trim().length > 0, `button[${action}] must have accessible text`);
  }
});

test('add-stock button displays 添加股票 as its text label', () => {
  setup(mkHeader());
  const btn = document.querySelector('button[data-action="add-stock"]') as HTMLButtonElement;
  assert.equal(btn.textContent, '添加股票');
});

test('price button shows open-eye icon (with pupil) when price is visible', () => {
  setup(mkHeader({ priceHidden: false }));
  const btn = document.querySelector('button[data-action="price-visibility"]') as HTMLElement;
  const pupil = btn.querySelector('circle');
  const slash = btn.querySelector('line');
  assert.ok(pupil, 'open eye should have a pupil circle');
  assert.ok(!slash, 'open eye should not have a slash line');
});

test('price button shows closed-eye icon (with slash) when price is hidden', () => {
  setup(mkHeader({ priceHidden: true }));
  const btn = document.querySelector('button[data-action="price-visibility"]') as HTMLElement;
  const pupil = btn.querySelector('circle');
  const slash = btn.querySelector('line');
  assert.ok(!pupil, 'closed eye should not have a pupil circle');
  assert.ok(slash, 'closed eye should have a slash line');
});

test('price button icon switches to closed-eye after toggling to hidden', () => {
  const { el } = setup(mkHeader({ priceHidden: false }));
  el.viewModel = mkHeader({ priceHidden: true });
  const btn = document.querySelector('button[data-action="price-visibility"]') as HTMLElement;
  assert.ok(btn.querySelector('line'), 'should now have slash line for closed eye');
  assert.ok(!btn.querySelector('circle'), 'should not have pupil for closed eye');
});

test('theme toggle button emits theme-change event (dark→light)', () => {
  const { spy } = setup(mkHeader({ theme: 'dark' }));
  spy.reset();
  clickAction('theme-toggle');
  assert.deepEqual(spy.lastEvent('theme-change')?.detail, { theme: 'light' });
});

test('theme toggle button emits theme-change event (light→dark)', () => {
  const { spy } = setup(mkHeader({ theme: 'light' }));
  spy.reset();
  clickAction('theme-toggle');
  assert.deepEqual(spy.lastEvent('theme-change')?.detail, { theme: 'dark' });
});

test('theme button label reflects the switchable target theme', () => {
  setup(mkHeader({ theme: 'dark' }));
  const darkBtn = document.querySelector('button[data-action="theme-toggle"]') as HTMLElement;
  const darkLabel = darkBtn.querySelector('.header-btn-label')?.textContent ?? '';
  assert.equal(darkLabel, '浅色');

  const { el } = setup(mkHeader({ theme: 'light' }));
  el.viewModel = mkHeader({ theme: 'light' });
  const lightBtn = document.querySelector('button[data-action="theme-toggle"]') as HTMLElement;
  const lightLabel = lightBtn.querySelector('.header-btn-label')?.textContent ?? '';
  assert.equal(lightLabel, '深色');
});
