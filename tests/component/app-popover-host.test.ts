// tests/component/app-popover-host.test.ts
// 计划 Task 6 — popover 宿主：内容切换、可访问名称、焦点契约、外部点击。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import { closedPopover } from '../../src/popup/view-models.js';
import type { PopoverViewModel } from '../../src/popup/view-models.js';
import type { StockCode, GroupId } from '../../src/domain/index.js';

const ANCHOR_ID = 'trigger-1';

function columnsVm(): PopoverViewModel {
  return {
    open: true,
    kind: 'column-settings',
    anchorId: ANCHOR_ID,
    columnPanel: {
      columns: [
        { key: 'name', label: '股票', enabled: true },
        { key: 'price', label: '现价', enabled: true }
      ],
      columnOrder: ['name', 'price']
    },
    stockActions: null
  };
}

function actionsVm(): PopoverViewModel {
  return {
    open: true,
    kind: 'stock-actions',
    anchorId: ANCHOR_ID,
    columnPanel: null,
    stockActions: {
      code: 'sh600519' as StockCode,
      name: '贵州茅台',
      pinned: false,
      canMoveUp: true,
      canMoveDown: true,
      groupId: 'g_all' as GroupId,
      orderedCodes: ['sh600519'] as unknown as StockCode[]
    }
  };
}

function setup(): {
  el: HTMLElement & { viewModel: PopoverViewModel };
  anchor: HTMLButtonElement;
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);

  const anchor = document.createElement('button');
  anchor.id = ANCHOR_ID;
  anchor.setAttribute('aria-expanded', 'false');
  container.append(anchor);

  const el = document.createElement('app-popover-host') as HTMLElement & {
    viewModel: PopoverViewModel;
  };
  container.append(el);
  return { el, anchor, spy };
}

function panel(): HTMLElement {
  return document.querySelector('.app-popover') as HTMLElement;
}

test('starts closed', () => {
  const { el } = setup();
  el.viewModel = closedPopover();
  assert.equal(panel().hidden, true);
});

test('opening column settings shows only the column panel', () => {
  const { el } = setup();
  el.viewModel = columnsVm();
  assert.equal(panel().hidden, false);
  assert.equal((document.querySelector('column-panel') as HTMLElement).hidden, false);
  assert.equal((document.querySelector('stock-action-menu') as HTMLElement).hidden, true);
});

test('opening stock actions shows only the action menu', () => {
  const { el } = setup();
  el.viewModel = actionsVm();
  assert.equal((document.querySelector('stock-action-menu') as HTMLElement).hidden, false);
  assert.equal((document.querySelector('column-panel') as HTMLElement).hidden, true);
});

test('accessible name follows the popover kind', () => {
  // 两种弹层共用同一个 role="dialog" 容器；标签不切换的话，
  // 屏幕阅读器会把股票操作菜单读成「列设置」。
  const { el } = setup();
  el.viewModel = columnsVm();
  assert.equal(panel().getAttribute('aria-label'), '列设置');
  el.viewModel = actionsVm();
  assert.ok(panel().getAttribute('aria-label')?.includes('贵州茅台'));
});

test('opening marks the anchor expanded and closing clears it', () => {
  const { el, anchor } = setup();
  el.viewModel = actionsVm();
  assert.equal(anchor.getAttribute('aria-expanded'), 'true');

  // 关闭态的 VM 不带 anchorId——必须用打开时记下的锚点复位，
  // 否则 aria-expanded 会永远停在 true。
  el.viewModel = closedPopover();
  assert.equal(anchor.getAttribute('aria-expanded'), 'false');
});

test('closing returns focus to the trigger', () => {
  const { el, anchor } = setup();
  el.viewModel = actionsVm();
  el.viewModel = closedPopover();
  assert.equal(document.activeElement?.id, ANCHOR_ID);
});

test('escape requests close only while open', () => {
  const { el, spy } = setup();
  el.viewModel = closedPopover();
  spy.reset();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(spy.eventCount('popover-close-request'), 0, '关闭态不应发出关闭请求');

  el.viewModel = actionsVm();
  spy.reset();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(spy.eventCount('popover-close-request'), 1);
});

test('a pointerdown on the trigger is not treated as an outside click', () => {
  // 否则会「打开即关闭」：同一次交互先打开，再被自己的点击判成外部点击。
  const { el, anchor, spy } = setup();
  el.viewModel = actionsVm();
  spy.reset();
  anchor.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  assert.equal(spy.eventCount('popover-close-request'), 0);
});

test('a pointerdown outside closes the popover', () => {
  const { el, spy } = setup();
  el.viewModel = actionsVm();
  spy.reset();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  assert.equal(spy.eventCount('popover-close-request'), 1);
});

test('a pointerdown inside the panel does not close it', () => {
  const { el, spy } = setup();
  el.viewModel = actionsVm();
  spy.reset();
  panel().dispatchEvent(new Event('pointerdown', { bubbles: true }));
  assert.equal(spy.eventCount('popover-close-request'), 0);
});

test('disconnecting removes the document-level listeners', () => {
  const { el, spy } = setup();
  el.viewModel = actionsVm();
  el.remove();
  spy.reset();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  assert.equal(spy.eventCount('popover-close-request'), 0, '断开后不得残留全局监听');
});
