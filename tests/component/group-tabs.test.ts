// tests/component/group-tabs.test.ts
// Task 15 Step 1 — group-tabs 组件测试。
// 断言：WAI-ARIA tablist 结构、roving tabindex、方向键导航 + 自动选中、
//       Enter/Space 选中、左移/右移重排请求、焦点在 keyed reorder 后保持。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { GroupTabViewModel } from '../../src/popup/view-models.js';
import type { GroupId } from '../../src/domain/index.js';

function g(id: string, name: string, isActive: boolean, order: number): GroupTabViewModel {
  return { groupId: id as GroupId, name, isActive, order };
}

const threeGroups: GroupTabViewModel[] = [
  g('g_all', '全部', true, 0),
  g('g_watch', '关注', false, 1),
  g('g_tech', '科技', false, 2)
];

function setup(tabs: GroupTabViewModel[] = threeGroups): {
  el: HTMLElement & { viewModel: GroupTabViewModel[] };
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('group-tabs') as HTMLElement & { viewModel: GroupTabViewModel[] };
  container.append(el);
  el.viewModel = tabs;
  return { el, spy };
}

function focusTab(groupId: string): void {
  const tab = document.querySelector(`button[data-group-id="${groupId}"]`) as HTMLElement | null;
  if (!tab) throw new Error(`Tab ${groupId} not found`);
  tab.focus();
}

function press(key: string): void {
  const target = document.activeElement as EventTarget | null;
  if (!target) throw new Error('No active element to receive keypress');
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function clickReorder(groupId: string, direction: 'left' | 'right'): void {
  const item = document.querySelector(`[data-key="${groupId}"]`);
  if (!item) throw new Error(`Tab item ${groupId} not found`);
  const btn = item.querySelector(`button[data-action="move-${direction}"]`) as HTMLButtonElement | null;
  if (!btn) throw new Error(`move-${direction} button for ${groupId} not found`);
  btn.click();
}

test('renders a nav containing a role=tablist', () => {
  setup();
  assert.ok(document.querySelector('nav'));
  assert.ok(document.querySelector('[role="tablist"]'));
});

test('each tab has role=tab, aria-selected, aria-controls=stock-board, and data-group-id', () => {
  setup();
  const tabs = document.querySelectorAll('button[role="tab"]');
  assert.equal(tabs.length, 3);
  for (const tab of tabs) {
    assert.equal(tab.getAttribute('role'), 'tab');
    assert.ok(tab.hasAttribute('aria-selected'));
    assert.equal(tab.getAttribute('aria-controls'), 'stock-board');
    assert.ok(tab.getAttribute('data-group-id'));
  }
});

test('active tab has tabindex 0 and inactive tabs have tabindex -1', () => {
  setup();
  const active = document.querySelector('button[role="tab"][aria-selected="true"]') as HTMLElement;
  const inactive = document.querySelectorAll('button[role="tab"][aria-selected="false"]');
  assert.equal(active.getAttribute('tabindex'), '0');
  for (const tab of inactive) {
    assert.equal(tab.getAttribute('tabindex'), '-1');
  }
});

test('ArrowRight moves and selects the next group tab', () => {
  const { spy } = setup();
  focusTab('g_all');
  spy.reset();
  press('ArrowRight');
  assert.equal(document.activeElement?.getAttribute('data-group-id'), 'g_watch');
  assert.deepEqual(spy.lastEvent('group-select')?.detail, { groupId: 'g_watch' });
});

test('ArrowLeft moves and selects the previous group tab', () => {
  const { spy } = setup();
  focusTab('g_tech');
  spy.reset();
  press('ArrowLeft');
  assert.equal(document.activeElement?.getAttribute('data-group-id'), 'g_watch');
  assert.deepEqual(spy.lastEvent('group-select')?.detail, { groupId: 'g_watch' });
});

test('ArrowRight wraps from last to first', () => {
  const { spy } = setup();
  focusTab('g_tech');
  spy.reset();
  press('ArrowRight');
  assert.equal(document.activeElement?.getAttribute('data-group-id'), 'g_all');
  assert.deepEqual(spy.lastEvent('group-select')?.detail, { groupId: 'g_all' });
});

test('ArrowLeft wraps from first to last', () => {
  const { spy } = setup();
  focusTab('g_all');
  spy.reset();
  press('ArrowLeft');
  assert.equal(document.activeElement?.getAttribute('data-group-id'), 'g_tech');
});

test('Home moves focus and selects the first tab', () => {
  const { spy } = setup();
  focusTab('g_tech');
  spy.reset();
  press('Home');
  assert.equal(document.activeElement?.getAttribute('data-group-id'), 'g_all');
  assert.deepEqual(spy.lastEvent('group-select')?.detail, { groupId: 'g_all' });
});

test('End moves focus and selects the last tab', () => {
  const { spy } = setup();
  focusTab('g_all');
  spy.reset();
  press('End');
  assert.equal(document.activeElement?.getAttribute('data-group-id'), 'g_tech');
  assert.deepEqual(spy.lastEvent('group-select')?.detail, { groupId: 'g_tech' });
});

test('Enter selects the currently focused tab', () => {
  const { spy } = setup();
  focusTab('g_watch');
  spy.reset();
  press('Enter');
  assert.deepEqual(spy.lastEvent('group-select')?.detail, { groupId: 'g_watch' });
});

test('Space selects the currently focused tab', () => {
  const { spy } = setup();
  focusTab('g_tech');
  spy.reset();
  press(' ');
  assert.deepEqual(spy.lastEvent('group-select')?.detail, { groupId: 'g_tech' });
});

test('clicking a tab selects it', () => {
  const { spy } = setup();
  spy.reset();
  const tab = document.querySelector('button[data-group-id="g_tech"]') as HTMLButtonElement;
  tab.click();
  assert.deepEqual(spy.lastEvent('group-select')?.detail, { groupId: 'g_tech' });
});

test('g_all (default group) has no reorder buttons', () => {
  setup();
  const allItem = document.querySelector('[data-key="g_all"]');
  assert.ok(allItem);
  assert.equal(allItem?.querySelectorAll('button[data-action^="move-"]').length, 0);
});

test('custom groups expose 左移 and 右移 buttons', () => {
  setup();
  const watchItem = document.querySelector('[data-key="g_watch"]');
  assert.ok(watchItem?.querySelector('button[data-action="move-left"]'));
  assert.ok(watchItem?.querySelector('button[data-action="move-right"]'));
});

test('右移 button emits group-order-request with the complete reordered array', () => {
  const { spy } = setup();
  spy.reset();
  clickReorder('g_watch', 'right');
  const detail = spy.lastEvent('group-order-request')?.detail;
  assert.ok(detail);
  assert.deepEqual(detail!.orderedGroupIds, ['g_all', 'g_tech', 'g_watch']);
});

test('左移 button emits group-order-request with the complete reordered array', () => {
  const { spy } = setup();
  spy.reset();
  clickReorder('g_tech', 'left');
  const detail = spy.lastEvent('group-order-request')?.detail;
  assert.ok(detail);
  assert.deepEqual(detail!.orderedGroupIds, ['g_all', 'g_tech', 'g_watch']);
});

test('左移 is disabled for the first custom group (cannot move before g_all)', () => {
  setup();
  const watchItem = document.querySelector('[data-key="g_watch"]');
  const leftBtn = watchItem?.querySelector('button[data-action="move-left"]') as HTMLButtonElement;
  assert.equal(leftBtn.disabled, true);
});

test('右移 is disabled for the last custom group', () => {
  setup();
  const techItem = document.querySelector('[data-key="g_tech"]');
  const rightBtn = techItem?.querySelector('button[data-action="move-right"]') as HTMLButtonElement;
  assert.equal(rightBtn.disabled, true);
});

test('reorder buttons have accessible labels', () => {
  setup();
  const watchItem = document.querySelector('[data-key="g_watch"]');
  const leftBtn = watchItem?.querySelector('button[data-action="move-left"]') as HTMLElement;
  const rightBtn = watchItem?.querySelector('button[data-action="move-right"]') as HTMLElement;
  assert.ok((leftBtn.getAttribute('aria-label') ?? '').includes('左移'));
  assert.ok((rightBtn.getAttribute('aria-label') ?? '').includes('右移'));
});

test('focus is preserved on the same group after keyed reorder', () => {
  const { el } = setup();
  focusTab('g_watch');
  // Reorder: move g_watch after g_tech → new order: g_all, g_tech, g_watch
  el.viewModel = [
    g('g_all', '全部', false, 0),
    g('g_tech', '科技', true, 1),
    g('g_watch', '关注', false, 2)
  ];
  // g_watch tab should still be focused after the re-render
  assert.equal(document.activeElement?.getAttribute('data-group-id'), 'g_watch');
});

test('updating active tab changes aria-selected and roving tabindex', () => {
  const { el } = setup();
  el.viewModel = [
    g('g_all', '全部', false, 0),
    g('g_watch', '关注', true, 1),
    g('g_tech', '科技', false, 2)
  ];
  const activeTab = document.querySelector('button[role="tab"][aria-selected="true"]') as HTMLElement;
  assert.equal(activeTab.getAttribute('data-group-id'), 'g_watch');
  assert.equal(activeTab.getAttribute('tabindex'), '0');
});

test('reconnecting group-tabs does not duplicate listeners', () => {
  const { el, spy } = setup();
  el.remove();
  document.body.querySelector('div')?.append(el);
  spy.reset();
  const tab = document.querySelector('button[data-group-id="g_watch"]') as HTMLButtonElement;
  tab.click();
  assert.equal(spy.eventCount('group-select'), 1);
});
