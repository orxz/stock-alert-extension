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
import { CommandController } from '../../../src/popup/commands/command-controller.js';
import { createRpcClientError } from '../../../src/popup/rpc-client.js';
import type { RpcClient } from '../../../src/popup/rpc-client.js';
import type { AppViewModel } from '../../../src/popup/view-models.js';
import { loadUiHoverDetails, UI_HOVER_DETAILS_STORAGE_KEY } from '../../../src/popup/ui-preferences.js';

function mkController(): CommandController {
  return { bootstrap: mock.fn(() => Promise.resolve()), refreshQuotes: mock.fn(() => Promise.resolve()), dialogSearchStocks: mock.fn(() => Promise.resolve()), addStock: mock.fn(() => Promise.resolve()), removeStocks: mock.fn(() => Promise.resolve()), moveStocks: mock.fn(() => Promise.resolve()), setPinned: mock.fn(() => Promise.resolve()), setOrder: mock.fn(() => Promise.resolve()), createGroup: mock.fn(() => Promise.resolve()), renameGroup: mock.fn(() => Promise.resolve()), deleteGroup: mock.fn(() => Promise.resolve()), setGroupOrder: mock.fn(() => Promise.resolve()), patchPreferences: mock.fn(() => Promise.resolve()) } as unknown as CommandController;
}

function setup() {
  resetDom();
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

test('hover details preference persists locally and never sends a business mutation', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const { store, stockApp, controller, shell } = setup();
  try {
    const initialDomain = store.getState().domain;
    for (const enabled of [true, false]) {
      stockApp.dispatchEvent(new CustomEvent('hover-details-change', { bubbles: true, detail: { enabled } }));
      assert.equal(store.getState().view.hoverDetails, enabled);
      assert.equal(stockApp.viewModel.board.hoverDetails, enabled);
      assert.equal(values.get(UI_HOVER_DETAILS_STORAGE_KEY), String(enabled));
      const reopened = createInitialState('dark', undefined, loadUiHoverDetails(storage));
      assert.equal(reopened.view.hoverDetails, enabled, 'a new popup restores the selection');
      assert.equal(store.getState().domain, initialDomain);
    }
    assert.equal((controller.patchPreferences as unknown as { mock: { callCount: () => number } }).mock.callCount(), 0);
  } finally {
    shell.destroy();
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

// ===== 刷新结果播报：必须反映本次刷新的真实结局 =====

/** 用真实 CommandController + 可控 RPC 装配 shell，并预置一次成功快照。 */
function setupWithRpc(call: RpcClient['call']) {
  resetDom();
  definePopupElements();
  const store = createStore(reducer, createInitialState());
  // 预置一次**成功**的历史快照：这正是假成功的温床——
  // 刷新失败时 domain.quotes 不会被重置，残留 fresh>0。
  store.dispatch({
    type: 'bootstrap/confirmed',
    result: {
      userData: { groups: [], watchlist: [], boardConfig: {} },
      revision: 'rev-1',
      quoteSnapshot: {
        results: {}, counts: { fresh: 3, cached: 0, missing: 0 },
        attemptedAt: 1, succeededAt: 1, generation: 1
      }
    }
  } as never);
  const controller = new CommandController({ call } as RpcClient, store);
  const stockApp = document.createElement('stock-app');
  document.body.append(stockApp);
  const fallback = document.createElement('div');
  document.body.append(fallback);
  const liveRegion = document.createElement('app-live-region');
  document.body.append(liveRegion);
  createAppShell({
    store, controller, stockApp, fallback, liveRegion,
    sink: { emit: () => {} }, clock: { now: () => 0 }
  });
  return { store, stockApp };
}

/** 触发刷新并等待 RPC + .then 链落定。 */
async function clickRefresh(stockApp: HTMLElement): Promise<void> {
  stockApp.dispatchEvent(
    new CustomEvent('quote-refresh-request', { bubbles: true, detail: { force: true } })
  );
  await new Promise((r) => setTimeout(r, 10));
}

test('a failed refresh never announces success', async () => {
  const { store, stockApp } = setupWithRpc(() =>
    Promise.reject(createRpcClientError('INTERNAL', 'service worker unavailable', true))
  );
  await clickRefresh(stockApp);

  assert.equal(store.getState().async.quoteRefresh.status, 'error');
  assert.notEqual(store.getState().overlay.toast?.message, '已更新');
  assert.equal(store.getState().overlay.toast?.kind, 'error');
});

test('a successful refresh with fresh quotes announces success', async () => {
  const { store, stockApp } = setupWithRpc(() =>
    Promise.resolve({
      results: {}, counts: { fresh: 2, cached: 0, missing: 0 },
      attemptedAt: 5, succeededAt: 5, generation: 2
    } as never)
  );
  await clickRefresh(stockApp);

  assert.equal(store.getState().async.quoteRefresh.status, 'success');
  assert.equal(store.getState().overlay.toast?.message, '已更新');
});

test('a refresh that yields no fresh quotes reports the cache fallback', async () => {
  const { store, stockApp } = setupWithRpc(() =>
    Promise.resolve({
      results: {}, counts: { fresh: 0, cached: 4, missing: 0 },
      attemptedAt: 5, succeededAt: null, generation: 2
    } as never)
  );
  await clickRefresh(stockApp);

  assert.equal(store.getState().overlay.toast?.message, '已保留缓存');
  assert.equal(store.getState().overlay.toast?.kind, 'info');
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
