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
  document.body.append(stockApp);
  const fallback = document.createElement('div');
  document.body.append(fallback);
  const liveRegion = document.createElement('app-live-region');
  document.body.append(liveRegion);
  const sink = { emit: mock.fn(() => {}) };
  const clock = { now: () => 0 };
  const shell = createAppShell({ store, controller, stockApp, fallback, liveRegion, sink, clock });
  return { store, controller, stockApp, fallback, shell, sink };
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
