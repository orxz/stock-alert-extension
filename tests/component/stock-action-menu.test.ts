// tests/component/stock-action-menu.test.ts
// 计划 Task 6 — 股票操作菜单：置顶 / 上移 / 下移 / 删除。
// 断言：语义事件负载精确、首末位禁用移动、删除只请求确认、执行后关闭菜单。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { StockActionMenuViewModel } from '../../src/popup/view-models.js';
import type { StockCode, GroupId } from '../../src/domain/index.js';

const ORDER = ['sh600519', 'sz000001', 'sz300750'] as unknown as StockCode[];

function menuVm(overrides: Partial<StockActionMenuViewModel> = {}): StockActionMenuViewModel {
  return {
    code: 'sz000001' as StockCode,
    name: '平安银行',
    pinned: false,
    canMoveUp: true,
    canMoveDown: true,
    groupId: 'g_all' as GroupId,
    orderedCodes: ORDER,
    ...overrides
  };
}

function setup(vm: StockActionMenuViewModel): {
  el: HTMLElement & { viewModel: StockActionMenuViewModel | null };
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('stock-action-menu') as HTMLElement & {
    viewModel: StockActionMenuViewModel | null;
  };
  container.append(el);
  el.viewModel = vm;
  return { el, spy };
}

function click(action: string): void {
  const btn = document.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement | null;
  if (!btn) throw new Error(`action ${action} not found`);
  btn.click();
}

test('renders menu semantics', () => {
  setup(menuVm());
  const menu = document.querySelector('stock-action-menu') as HTMLElement;
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.equal(document.querySelectorAll('button[role="menuitem"]').length, 4);
});

test('pin emits the toggled state with the target hoisted to the front', () => {
  const { spy } = setup(menuVm({ pinned: false }));
  spy.reset();
  click('pin');
  const detail = spy.lastEvent('stock-pin-request')?.detail;
  assert.equal(detail!.code, 'sz000001');
  assert.equal(detail!.pinned, true);
  assert.deepEqual(detail!.orderedCodes, ['sz000001', 'sh600519', 'sz300750']);
});

test('unpinning keeps the existing order', () => {
  const { spy } = setup(menuVm({ pinned: true }));
  spy.reset();
  click('pin');
  const detail = spy.lastEvent('stock-pin-request')?.detail;
  assert.equal(detail!.pinned, false);
  assert.deepEqual(detail!.orderedCodes, ORDER);
});

test('pin label reflects the current state', () => {
  setup(menuVm({ pinned: true }));
  const btn = document.querySelector('button[data-action="pin"]') as HTMLElement;
  assert.equal(btn.textContent, '取消置顶');
  assert.ok((btn.getAttribute('aria-label') ?? '').includes('平安银行'));
});

test('move up and down emit the complete final order', () => {
  const { spy } = setup(menuVm());
  spy.reset();
  click('move-up');
  assert.deepEqual(
    spy.lastEvent('stock-order-request')?.detail.orderedCodes,
    ['sz000001', 'sh600519', 'sz300750']
  );

  const again = setup(menuVm());
  again.spy.reset();
  click('move-down');
  assert.deepEqual(
    again.spy.lastEvent('stock-order-request')?.detail.orderedCodes,
    ['sh600519', 'sz300750', 'sz000001']
  );
});

test('move buttons are disabled at the list boundaries', () => {
  setup(menuVm({ canMoveUp: false, canMoveDown: true }));
  const up = document.querySelector('button[data-action="move-up"]') as HTMLButtonElement;
  const down = document.querySelector('button[data-action="move-down"]') as HTMLButtonElement;
  assert.equal(up.disabled, true, 'first item cannot move up');
  assert.equal(down.disabled, false);
});

test('a disabled move button emits nothing', () => {
  const { spy } = setup(menuVm({ canMoveUp: false }));
  spy.reset();
  click('move-up');
  assert.equal(spy.eventCount('stock-order-request'), 0);
});

test('remove only requests confirmation and never deletes directly', () => {
  const { spy } = setup(menuVm());
  spy.reset();
  click('remove');
  const detail = spy.lastEvent('stock-remove-confirm-request')?.detail;
  assert.ok(detail, 'confirmation requested');
  assert.equal(detail!.code, 'sz000001');
  assert.equal(detail!.groupId, 'g_all');
  // 关键不变量：菜单绝不直接发出删除命令。
  assert.equal(spy.eventCount('stock-remove-request'), 0);
});

test('acting closes the menu, except remove which hands off to the dialog', () => {
  const { spy } = setup(menuVm());
  spy.reset();
  click('pin');
  assert.equal(spy.eventCount('popover-close-request'), 1);

  const removal = setup(menuVm());
  removal.spy.reset();
  click('remove');
  assert.equal(removal.spy.eventCount('popover-close-request'), 0, 'dialog owns the close');
});

test('reconnecting does not duplicate listeners', () => {
  const { el, spy } = setup(menuVm());
  el.remove();
  document.body.querySelector('div')?.append(el);
  spy.reset();
  click('pin');
  assert.equal(spy.eventCount('stock-pin-request'), 1);
});
