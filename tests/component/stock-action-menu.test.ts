import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { GroupId, StockCode } from '../../src/domain/index.js';
import type { PopoverViewModel, StockCardViewModel } from '../../src/popup/view-models.js';
import { DEFAULT_UI_COLUMNS } from '../../src/popup/ui-preferences.js';

const GROUP_ID = 'g_all' as GroupId;
const ORDERED_CODES = ['sh600519', 'sz000001', 'bj920001'] as StockCode[];

function stock(code: StockCode, overrides: Partial<StockCardViewModel> = {}): StockCardViewModel {
  return {
    code,
    name: `股票${code}`,
    price: 100,
    change: 1,
    changePercent: 1,
    status: 'fresh',
    pinned: false,
    staleLabel: '',
    displayPrice: '100.00',
    displayChange: '+1.00',
    displayAmount: '1.2亿',
    ...overrides
  };
}

function menuVm(code: StockCode = ORDERED_CODES[1], overrides: Partial<PopoverViewModel> = {}): PopoverViewModel {
  return {
    open: true,
    kind: 'stock-actions',
    anchorId: `stock-actions-${code}`,
    groupId: GROUP_ID,
    stock: stock(code),
    orderedCodes: ORDERED_CODES,
    columnPanel: { columns: DEFAULT_UI_COLUMNS },
    ...overrides
  };
}

function setup(vm = menuVm()): {
  el: HTMLElement & { viewModel: PopoverViewModel };
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('stock-action-menu') as HTMLElement & { viewModel: PopoverViewModel };
  container.append(el);
  el.viewModel = vm;
  return { el, spy };
}

function click(action: string): void {
  const button = document.querySelector(`stock-action-menu button[data-action="${action}"]`) as HTMLButtonElement | null;
  if (!button) throw new Error(`missing ${action} button`);
  button.click();
}

test('pin emits the exact final pin payload', () => {
  const { spy } = setup(menuVm(ORDERED_CODES[1], { stock: stock(ORDERED_CODES[1], { pinned: false }) }));
  spy.reset();

  click('pin');

  assert.deepEqual(spy.lastEvent('stock-pin-request')?.detail, {
    code: 'sz000001',
    pinned: true,
    orderedCodes: ['sz000001', 'sh600519', 'bj920001']
  });
});

test('move up and down emit complete final orders', () => {
  const { spy } = setup();
  spy.reset();

  click('move-up');
  assert.deepEqual(spy.lastEvent('stock-order-request')?.detail, {
    groupId: 'g_all',
    orderedCodes: ['sz000001', 'sh600519', 'bj920001']
  });

  click('move-down');
  assert.deepEqual(spy.lastEvent('stock-order-request')?.detail, {
    groupId: 'g_all',
    orderedCodes: ['sh600519', 'bj920001', 'sz000001']
  });
});

test('first and last stock move controls are disabled', () => {
  setup(menuVm(ORDERED_CODES[0]));
  assert.equal((document.querySelector('button[data-action="move-up"]') as HTMLButtonElement).disabled, true);

  setup(menuVm(ORDERED_CODES[2]));
  assert.equal((document.querySelector('button[data-action="move-down"]') as HTMLButtonElement).disabled, true);
});

test('remove requests confirmation for exactly one stock and never removes immediately', () => {
  const { spy } = setup();
  spy.reset();

  click('remove');

  assert.deepEqual(spy.lastEvent('stock-remove-confirm-request')?.detail, { code: 'sz000001' });
  assert.equal(spy.eventCount('stock-remove-request'), 0);
});

test('all stock menu actions are native labelled buttons', () => {
  setup();
  const buttons = document.querySelectorAll('stock-action-menu button');
  assert.equal(buttons.length, 4);
  for (const button of buttons) {
    assert.ok((button.getAttribute('aria-label') ?? '').length > 0);
  }
});

test('Arrow, Home, and End move focus among enabled menu actions', () => {
  const { el } = setup();
  const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
  buttons[0].focus();

  buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(document.activeElement?.getAttribute('data-action'), 'move-up');

  buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  assert.equal(document.activeElement?.getAttribute('data-action'), 'remove');

  buttons.at(-1)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  assert.equal(document.activeElement?.getAttribute('data-action'), 'pin');

  buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  assert.equal(document.activeElement?.getAttribute('data-action'), 'remove');
});
