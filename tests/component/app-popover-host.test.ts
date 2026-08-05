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
const CODE = 'sh600519' as StockCode;

function stock(): StockCardViewModel {
  return {
    code: CODE,
    name: '贵州茅台',
    price: 100,
    change: 1,
    changePercent: 1,
    status: 'fresh',
    pinned: false,
    staleLabel: '',
    displayPrice: '100.00',
    displayChange: '+1.00',
    displayAmount: '1.2亿'
  };
}

function openStock(anchorId = 'stock-actions-sh600519'): PopoverViewModel {
  return {
    open: true,
    kind: 'stock-actions',
    anchorId,
    groupId: GROUP_ID,
    stock: stock(),
    orderedCodes: [CODE],
    columnPanel: { columns: DEFAULT_UI_COLUMNS }
  };
}

function openColumns(anchorId = 'column-settings-trigger'): PopoverViewModel {
  return {
    open: true,
    kind: 'column-settings',
    anchorId,
    groupId: GROUP_ID,
    stock: null,
    orderedCodes: [],
    columnPanel: { columns: DEFAULT_UI_COLUMNS }
  };
}

function setup(vm: PopoverViewModel, withAnchor = true): {
  host: HTMLElement & { viewModel: PopoverViewModel };
  anchor: HTMLButtonElement;
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const anchor = document.createElement('button');
  anchor.id = vm.anchorId ?? '';
  anchor.textContent = 'open';
  if (withAnchor) container.append(anchor);
  const host = document.createElement('app-popover-host') as HTMLElement & { viewModel: PopoverViewModel };
  container.append(host);
  host.viewModel = vm;
  return { host, anchor, spy };
}

test('renders the focused component selected by the menu discriminator', () => {
  const { host } = setup(openStock());
  assert.ok(host.querySelector('stock-action-menu'));
  assert.equal(host.querySelector('column-panel'), null);

  host.viewModel = openColumns('stock-actions-sh600519');
  assert.ok(host.querySelector('column-panel'));
  assert.equal(host.querySelector('stock-action-menu'), null);
});

test('uses fixed positioning clamped inside the viewport', () => {
  const previousWidth = window.innerWidth;
  const previousHeight = window.innerHeight;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 100 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 100 });
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
    if (this.id === 'stock-actions-sh600519') {
      return { left: 90, top: 85, right: 98, bottom: 95, width: 8, height: 10, x: 90, y: 85, toJSON() {} } as DOMRect;
    }
    if (this.localName === 'app-popover-host') {
      return { left: 0, top: 0, right: 40, bottom: 40, width: 40, height: 40, x: 0, y: 0, toJSON() {} } as DOMRect;
    }
    return originalRect.call(this);
  };

  try {
    const { host } = setup(openStock());
    assert.equal(host.style.position, 'fixed');
    assert.ok(Number.parseFloat(host.style.left) <= 52);
    assert.ok(Number.parseFloat(host.style.top) <= 52);
    assert.ok(Number.parseFloat(host.style.left) >= 8);
    assert.ok(Number.parseFloat(host.style.top) >= 8);
  } finally {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: previousHeight });
  }
});

test('Escape emits close and restores focus to the trigger', () => {
  const { host, anchor, spy } = setup(openStock());
  spy.reset();
  (host.querySelector('button') as HTMLButtonElement).focus();

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  assert.deepEqual(spy.lastEvent('popover-close-request')?.detail, { reason: 'escape' });
  assert.equal(document.activeElement, anchor);
});

test('outside pointerdown emits close and restores focus to the trigger', () => {
  const { anchor, spy } = setup(openStock());
  const outside = document.createElement('button');
  document.body.append(outside);
  spy.reset();

  outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));

  assert.deepEqual(spy.lastEvent('popover-close-request')?.detail, { reason: 'outside' });
  assert.equal(document.activeElement, anchor);
});

test('missing anchor closes safely without throwing', () => {
  assert.doesNotThrow(() => {
    const { host, spy } = setup(openStock('deleted-trigger'), false);
    assert.equal(host.hidden, true);
    assert.deepEqual(spy.lastEvent('popover-close-request')?.detail, { reason: 'missing-anchor' });
  });
});
