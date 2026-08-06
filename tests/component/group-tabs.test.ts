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
  el: HTMLElement & { viewModel: GroupTabViewModel[]; selectionMode: boolean };
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('group-tabs') as HTMLElement & { viewModel: GroupTabViewModel[]; selectionMode: boolean };
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
  const item = document.querySelector(`[data-region="tab-actions"] [data-group-id="${groupId}"]`);
  if (!item) throw new Error(`Tab item ${groupId} not found`);
  const btn = item.querySelector(`button[data-action="move-${direction}"]`) as HTMLButtonElement | null;
  if (!btn) throw new Error(`move-${direction} button for ${groupId} not found`);
  btn.click();
}

// ===== 管理持仓按钮（从 Header 移到 GroupTabs actions） =====

test('manage-holdings button exists in right-actions', () => {
  setup();
  const btn = document.querySelector('[data-region="right-actions"] button[data-action="manage-holdings"]');
  assert.ok(btn, 'manage-holdings button should exist in right-actions');
});

/**
 * 按钮名必须表达「用户来做什么」而不是「怎么点」。
 * 「多选」描述交互手段；该模式的出口是全选/移动分组/移除，即管理自选持仓。
 * 可见文案与 aria-label 一并锁死，避免只改一处、读屏仍念旧名。
 */
test('manage-holdings button is named for the task, not the interaction', () => {
  setup();
  const btn = document.querySelector('button[data-action="manage-holdings"]') as HTMLElement;
  assert.equal(btn.querySelector('span')?.textContent, '管理持仓');
  assert.equal(btn.getAttribute('aria-label'), '管理持仓');
});

test('add-group button exists in group-actions', () => {
  setup();
  const btn = document.querySelector('[data-region="group-actions"] button[data-action="add-group"]');
  assert.ok(btn, 'add-group button should exist in group-actions');
});

test('clicking manage-holdings emits selection-mode-change with enabled true', () => {
  const { spy } = setup();
  spy.reset();
  const btn = document.querySelector('button[data-action="manage-holdings"]') as HTMLButtonElement;
  btn.click();
  assert.deepEqual(spy.lastEvent('selection-mode-change')?.detail, { enabled: true });
});

test('manage-holdings button aria-pressed reflects selectionMode', () => {
  const { el } = setup();
  el.selectionMode = true;
  const btn = document.querySelector('button[data-action="manage-holdings"]') as HTMLElement;
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
});

// ===== 重命名入口：必须带上「被点的那个」分组 =====
// 回归防线：事件不带 groupId 时，app-shell 会回落到 currentGroupId。
// 右键不会激活标签，于是右键「关注」实际改的是当前激活的「全部」(g_all)——
// 而 g_all 恰恰是删除逻辑专门设防、不允许改动的默认分组。

test('right-click on a non-active tab renames THAT group, not the active one', () => {
  const { spy } = setup(); // g_all 处于激活态，g_watch 未激活
  spy.reset();
  const tab = document.querySelector('button[data-group-id="g_watch"]') as HTMLElement;
  tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const detail = spy.lastEvent('dialog-open-request')?.detail;
  assert.equal(detail?.kind, 'rename-group');
  assert.equal(detail?.groupId, 'g_watch', '必须是被右键的分组，而不是当前激活分组');
});

test('double-click on a non-active tab renames THAT group', () => {
  const { spy } = setup();
  spy.reset();
  const tab = document.querySelector('button[data-group-id="g_tech"]') as HTMLElement;
  tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  const detail = spy.lastEvent('dialog-open-request')?.detail;
  assert.equal(detail?.kind, 'rename-group');
  assert.equal(detail?.groupId, 'g_tech');
});

test('right-click on g_all does not open the rename dialog', () => {
  const { spy } = setup();
  spy.reset();
  const tab = document.querySelector('button[data-group-id="g_all"]') as HTMLElement;
  tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.equal(spy.lastEvent('dialog-open-request'), undefined);
});

// 420px 宽度硬约束：每个分组常驻一对重排箭头会把右侧「管理持仓」挤出屏幕。
test('reorder arrows are shown only for the active group', () => {
  setup();
  const visible = [...document.querySelectorAll('[data-region="tab-actions"] .group-tab-move-group')]
    .filter((n) => !(n as HTMLElement).hidden)
    .map((n) => n.getAttribute('data-group-id'));
  assert.deepEqual(visible, [], 'g_all 激活时不该有任何箭头（默认分组不可重排）');

  const el = document.querySelector('group-tabs') as HTMLElement & { viewModel: GroupTabViewModel[] };
  el.viewModel = [g('g_all', '全部', false, 0), g('g_watch', '关注', true, 1), g('g_tech', '科技', false, 2)];
  const nowVisible = [...document.querySelectorAll('[data-region="tab-actions"] .group-tab-move-group')]
    .filter((n) => !(n as HTMLElement).hidden)
    .map((n) => n.getAttribute('data-group-id'));
  assert.deepEqual(nowVisible, ['g_watch'], '只有激活分组显示箭头');
});

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
  const allItem = document.querySelector('[data-region="tab-actions"] [data-group-id="g_all"]');
  assert.ok(allItem);
  assert.equal(allItem?.querySelectorAll('button[data-action^="move-"]').length, 0);
});

test('custom groups expose 左移 and 右移 buttons', () => {
  setup();
  const watchItem = document.querySelector('[data-region="tab-actions"] [data-group-id="g_watch"]');
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
  const watchItem = document.querySelector('[data-region="tab-actions"] [data-group-id="g_watch"]');
  const leftBtn = watchItem?.querySelector('button[data-action="move-left"]') as HTMLButtonElement;
  assert.equal(leftBtn.disabled, true);
});

test('右移 is disabled for the last custom group', () => {
  setup();
  const techItem = document.querySelector('[data-region="tab-actions"] [data-group-id="g_tech"]');
  const rightBtn = techItem?.querySelector('button[data-action="move-right"]') as HTMLButtonElement;
  assert.equal(rightBtn.disabled, true);
});

test('reorder buttons have accessible labels', () => {
  setup();
  const watchItem = document.querySelector('[data-region="tab-actions"] [data-group-id="g_watch"]');
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
