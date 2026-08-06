// tests/component/batch-toolbar.test.ts
// Task 16 Step 1 — batch-toolbar 组件测试。
// 断言：selected count、move/remove/cancel 原生按钮、事件发射、隐藏状态。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { BatchToolbarViewModel } from '../../src/popup/view-models.js';
import type { StockCode, GroupId } from '../../src/domain/index.js';

function batch(overrides: Partial<BatchToolbarViewModel> = {}): BatchToolbarViewModel {
  return {
    visible: true,
    selectedCount: 2,
    totalCount: 5,
    selectedCodes: ['sh600519' as StockCode, 'sz000001' as StockCode],
    groupId: 'g_all' as GroupId,
    ...overrides
  };
}

function setup(vm?: BatchToolbarViewModel): {
  el: HTMLElement & { viewModel: BatchToolbarViewModel };
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('batch-toolbar') as HTMLElement & { viewModel: BatchToolbarViewModel };
  container.append(el);
  if (vm) el.viewModel = vm;
  return { el, spy };
}

function clickAction(action: string): void {
  const btn = document.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement | null;
  if (!btn) throw new Error(`button[data-action="${action}"] not found`);
  btn.click();
}

test('displays the selected count', () => {
  setup(batch({ selectedCount: 3 }));
  const el = document.querySelector('batch-toolbar') as HTMLElement;
  assert.ok(el.textContent?.includes('3'));
});

test('has move, remove, and cancel buttons', () => {
  setup(batch());
  assert.ok(document.querySelector('button[data-action="batch-move"]'));
  assert.ok(document.querySelector('button[data-action="batch-remove"]'));
  assert.ok(document.querySelector('button[data-action="batch-cancel"]'));
});

test('move button emits dialog-open-request with kind move-stocks', () => {
  const { spy } = setup(batch());
  spy.reset();
  clickAction('batch-move');
  assert.deepEqual(spy.lastEvent('dialog-open-request')?.detail, { kind: 'move-stocks' });
});

test('remove button emits dialog-open-request with kind confirm-remove', () => {
  const { spy } = setup(batch());
  spy.reset();
  clickAction('batch-remove');
  assert.deepEqual(spy.lastEvent('dialog-open-request')?.detail, { kind: 'confirm-remove' });
});

test('cancel button emits selection-mode-change with enabled false', () => {
  const { spy } = setup(batch());
  spy.reset();
  clickAction('batch-cancel');
  assert.deepEqual(spy.lastEvent('selection-mode-change')?.detail, { enabled: false });
});

test('toolbar is hidden when visible is false', () => {
  setup(batch({ visible: false }));
  const el = document.querySelector('batch-toolbar') as HTMLElement;
  assert.ok(el.hasAttribute('hidden'));
});

test('toolbar is visible when visible is true', () => {
  setup(batch({ visible: true }));
  const el = document.querySelector('batch-toolbar') as HTMLElement;
  assert.ok(!el.hasAttribute('hidden'));
});

test('all buttons have accessible labels', () => {
  setup(batch());
  const actions = ['batch-move', 'batch-remove', 'batch-cancel'];
  for (const action of actions) {
    const btn = document.querySelector(`button[data-action="${action}"]`) as HTMLElement;
    const label = btn.getAttribute('aria-label') ?? btn.textContent ?? '';
    assert.ok(label.trim().length > 0, `${action} should have a label`);
  }
});

test('all buttons meet 44px touch target via CSS class', () => {
  setup(batch());
  const buttons = document.querySelectorAll('batch-toolbar button');
  for (const btn of buttons) {
    assert.ok(btn.classList.contains('batch-toolbar-btn'));
  }
});

test('updating viewModel updates selected count', () => {
  const { el } = setup(batch({ selectedCount: 2 }));
  el.viewModel = batch({ selectedCount: 5 });
  const toolbar = document.querySelector('batch-toolbar') as HTMLElement;
  assert.ok(toolbar.textContent?.includes('5'));
});

test('reconnecting does not duplicate listeners', () => {
  const { el, spy } = setup(batch());
  el.remove();
  document.body.querySelector('div')?.append(el);
  spy.reset();
  clickAction('batch-cancel');
  assert.equal(spy.eventCount('selection-mode-change'), 1);
});

// ===== 全选 / 取消全选 =====

test('clicking select-all emits batch-select-all', () => {
  const { spy } = setup(batch());
  spy.reset();
  clickAction('batch-select-all');
  assert.equal(spy.eventCount('batch-select-all'), 1);
});

test('select-all flips to 取消全选 once everything is selected', () => {
  const { el } = setup(batch({ selectedCount: 2, totalCount: 5 }));
  const btn = document.querySelector('button[data-action="batch-select-all"]') as HTMLButtonElement;
  assert.equal(btn.textContent, '全选');
  el.viewModel = batch({ selectedCount: 5, totalCount: 5 });
  assert.equal(btn.textContent, '取消全选');
});

// aria-label 优先于可见文本：只改 textContent 会让读屏永远念「全选」。
test('select-all accessible name tracks the visible label', () => {
  const { el } = setup(batch({ selectedCount: 2, totalCount: 5 }));
  const btn = document.querySelector('button[data-action="batch-select-all"]') as HTMLButtonElement;
  assert.equal(btn.getAttribute('aria-label'), '全选');
  el.viewModel = batch({ selectedCount: 5, totalCount: 5 });
  assert.equal(btn.getAttribute('aria-label'), '取消全选');
});
