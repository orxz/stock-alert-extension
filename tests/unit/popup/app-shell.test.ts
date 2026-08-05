import '../../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mock } from 'node:test';
import { resetDom } from '../../helpers/dom-environment.js';
import { definePopupElements } from '../../../src/popup/components/define-elements.js';
import { createStore } from '../../../src/popup/store/store.js';
import { reducer } from '../../../src/popup/store/reducer.js';
import { createInitialState } from '../../../src/popup/store/state.js';
import { createAppShell } from '../../../src/popup/app-shell.js';
import type { CommandController } from '../../../src/popup/commands/command-controller.js';
import type { AppViewModel } from '../../../src/popup/view-models.js';
import { DEFAULT_UI_COLUMNS, UI_COLUMNS_STORAGE_KEY } from '../../../src/popup/ui-preferences.js';

function mkController(): CommandController {
  return { bootstrap: mock.fn(() => Promise.resolve()), refreshQuotes: mock.fn(() => Promise.resolve()), searchStocks: mock.fn(() => Promise.resolve()), addStock: mock.fn(() => Promise.resolve()), removeStocks: mock.fn(() => Promise.resolve()), moveStocks: mock.fn(() => Promise.resolve()), setPinned: mock.fn(() => Promise.resolve()), setOrder: mock.fn(() => Promise.resolve()), createGroup: mock.fn(() => Promise.resolve()), renameGroup: mock.fn(() => Promise.resolve()), deleteGroup: mock.fn(() => Promise.resolve()), setGroupOrder: mock.fn(() => Promise.resolve()), patchPreferences: mock.fn(() => Promise.resolve()) } as unknown as CommandController;
}

function setup() {
  resetDom();
  window.localStorage.clear();
  definePopupElements();
  const store = createStore(reducer, createInitialState());
  const controller = mkController();
  const stockApp = document.createElement('stock-app') as HTMLElement & { viewModel: AppViewModel };
  const listeners = new Map<string, EventListener>();
  const addEventListener = stockApp.addEventListener.bind(stockApp);
  stockApp.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void => {
    if (typeof listener === 'function') listeners.set(type, listener);
    addEventListener(type, listener, options);
  }) as typeof stockApp.addEventListener;
  document.body.append(stockApp);
  const fallback = document.createElement('div');
  document.body.append(fallback);
  const liveRegion = document.createElement('app-live-region');
  document.body.append(liveRegion);
  const dialogHost = document.createElement('app-dialog-host');
  document.body.append(dialogHost);
  const popoverHost = document.createElement('app-popover-host');
  document.body.append(popoverHost);
  const sink = { emit: mock.fn(() => {}) };
  const clock = { now: () => 0 };
  const shell = createAppShell({ store, controller, stockApp, fallback, liveRegion, dialogHost, popoverHost, sink, clock });
  return { store, controller, stockApp, fallback, liveRegion, dialogHost, popoverHost, shell, sink, listeners };
}

test('column-settings-change updates presentation state and localStorage without RPC', () => {
  const { stockApp, store, controller } = setup();
  const domain = store.getState().domain;

  stockApp.dispatchEvent(new CustomEvent('column-settings-change', {
    bubbles: true,
    detail: {
      columns: { version: 1, enabled: ['status'], order: ['status'] }
    }
  }));

  assert.deepEqual(store.getState().view.columns, {
    version: 1,
    enabled: ['name', 'price', 'changePercent', 'status'],
    order: ['name', 'price', 'changePercent', 'status', 'amount', 'code']
  });
  assert.equal(store.getState().domain, domain);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(UI_COLUMNS_STORAGE_KEY) ?? ''), store.getState().view.columns);
  assert.equal((controller.patchPreferences as unknown as { mock: { callCount: () => number } }).mock.callCount(), 0);
  assert.notDeepEqual(store.getState().view.columns, DEFAULT_UI_COLUMNS);
});

test('column-settings-change still updates Store when the localStorage getter throws', () => {
  const { stockApp, store, listeners } = setup();
  const listener = listeners.get('column-settings-change');
  assert.ok(listener);
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get(): never {
      throw new DOMException('blocked', 'SecurityError');
    }
  });

  try {
    assert.doesNotThrow(() => {
      listener.call(stockApp, new CustomEvent('column-settings-change', {
        detail: {
          columns: { version: 1, enabled: ['code'], order: ['code'] }
        }
      }));
    });
    assert.deepEqual(store.getState().view.columns, {
      version: 1,
      enabled: ['name', 'price', 'changePercent', 'code'],
      order: ['name', 'price', 'changePercent', 'code', 'amount', 'status']
    });
  } finally {
    if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
  }
});

test('renderAppSafely shows stockApp and hides fallback', () => {
  const { stockApp, fallback } = setup();
  assert.equal(stockApp.hidden, false);
  assert.equal(fallback.hidden, true);
});

test('quote-refresh-request triggers refreshQuotes', () => {
  const { stockApp, controller } = setup();
  stockApp.dispatchEvent(new CustomEvent('quote-refresh-request', { bubbles: true, detail: { force: true } }));
  assert.ok((controller.refreshQuotes as unknown as { mock: { callCount: () => number } }).mock.callCount() >= 1);
});

test('stock-pin-request triggers setPinned', () => {
  const { stockApp, controller } = setup();
  stockApp.dispatchEvent(new CustomEvent('stock-pin-request', { bubbles: true, detail: { code: 'sh600519', pinned: true, orderedCodes: ['sh600519'] } }));
  assert.ok((controller.setPinned as unknown as { mock: { callCount: () => number } }).mock.callCount() >= 1);
});

test('stock menu open request stores the target while a missing stock renders closed safely', () => {
  const { stockApp, popoverHost, store } = setup();
  stockApp.dispatchEvent(new CustomEvent('stock-menu-open-request', {
    bubbles: true,
    detail: { anchorId: 'stock-actions-sh600519', code: 'sh600519' }
  }));

  assert.deepEqual(store.getState().overlay.menu, {
    kind: 'stock-actions',
    anchorId: 'stock-actions-sh600519',
    code: 'sh600519'
  });
  assert.equal((popoverHost as HTMLElement & { viewModel: { kind: string | null } }).viewModel.kind, null);
});

test('column settings button has an anchor and opens the shared popover', () => {
  const { stockApp, store } = setup();
  const button = stockApp.querySelector('button[data-action="column-settings"]') as HTMLButtonElement;
  assert.equal(button.id, 'column-settings-trigger');
  button.focus();
  button.click();

  assert.deepEqual(store.getState().overlay.menu, {
    kind: 'column-settings',
    anchorId: 'column-settings-trigger'
  });
});

test('popover close request clears only the menu overlay', () => {
  const { stockApp, popoverHost, store } = setup();
  stockApp.dispatchEvent(new CustomEvent('column-panel-open-request', { bubbles: true, detail: {} }));
  assert.ok(store.getState().overlay.menu);

  popoverHost.dispatchEvent(new CustomEvent('popover-close-request', {
    bubbles: true,
    detail: { reason: 'escape' }
  }));

  assert.equal(store.getState().overlay.menu, null);
  assert.equal(store.getState().overlay.dialog, null);
});

test('events from the popover host reuse existing pin and column commands', () => {
  const { popoverHost, controller, store } = setup();
  popoverHost.dispatchEvent(new CustomEvent('stock-pin-request', {
    bubbles: true,
    detail: { code: 'sh600519', pinned: true, orderedCodes: ['sh600519'] }
  }));
  assert.equal((controller.setPinned as unknown as { mock: { callCount(): number } }).mock.callCount(), 1);

  popoverHost.dispatchEvent(new CustomEvent('column-settings-change', {
    bubbles: true,
    detail: { columns: { version: 1, enabled: ['status'], order: ['status'] } }
  }));
  assert.ok(store.getState().view.columns.enabled.includes('status'));
});

test('stock remove asks for a one-stock confirmation and never deletes immediately', () => {
  const { stockApp, popoverHost, dialogHost, store, controller } = setup();
  stockApp.dispatchEvent(new CustomEvent('stock-menu-open-request', {
    bubbles: true,
    detail: { anchorId: 'stock-actions-sh600519', code: 'sh600519' }
  }));

  popoverHost.dispatchEvent(new CustomEvent('stock-remove-confirm-request', {
    bubbles: true,
    detail: { code: 'sh600519' }
  }));

  assert.deepEqual(store.getState().overlay.dialog, {
    kind: 'confirm-remove',
    codes: ['sh600519'],
    groupId: 'g_all'
  });
  assert.equal(store.getState().overlay.menu, null);
  assert.equal((controller.removeStocks as unknown as { mock: { callCount(): number } }).mock.callCount(), 0);

  dialogHost.dispatchEvent(new CustomEvent('dialog-submit', {
    bubbles: true,
    detail: { kind: 'remove-stocks', codes: ['sh600519'], groupId: 'g_all' }
  }));
  assert.equal((controller.removeStocks as unknown as { mock: { callCount(): number } }).mock.callCount(), 1);
});

test('legacy stock-remove-request is also confirm-only', () => {
  const { stockApp, store, controller } = setup();

  stockApp.dispatchEvent(new CustomEvent('stock-remove-request', {
    bubbles: true,
    detail: { codes: ['sh600519'], groupId: 'g_all' }
  }));

  assert.deepEqual(store.getState().overlay.dialog, {
    kind: 'confirm-remove',
    codes: ['sh600519'],
    groupId: 'g_all'
  });
  assert.equal((controller.removeStocks as unknown as { mock: { callCount(): number } }).mock.callCount(), 0);
});

test('destroy is idempotent', () => {
  const { shell } = setup();
  shell.destroy();
  assert.doesNotThrow(() => shell.destroy());
});

test('safe render shows fallback outside a failed component tree', () => {
  const { stockApp, fallback, store, sink } = setup();
  // Normal: stockApp visible, fallback hidden.
  assert.equal(stockApp.hidden, false);
  assert.equal(fallback.hidden, true);
  // Corrupt state to force renderAppSafely to throw via selectAppViewModel.
  // We simulate by replacing store.getState to throw.
  const originalGetState = store.getState;
  (store as unknown as { getState: () => never }).getState = () => { throw new Error('forced render failure'); };
  // Dispatch triggers renderAppSafely → catch → fallback shown.
  store.dispatch({ type: 'view/searchKeyword', keyword: '' });
  assert.equal(stockApp.hidden, true);
  assert.equal(fallback.hidden, false);
  // Diagnostic sink emitted a render-failed event.
  assert.ok(sink.emit.mock.callCount() >= 1);
  // Restore.
  (store as unknown as { getState: typeof originalGetState }).getState = originalGetState;
});
