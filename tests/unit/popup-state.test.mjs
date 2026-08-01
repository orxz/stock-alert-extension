import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
global.StockUtils = require('../../stock-utils.js');
global.document = undefined;
const State = require('../../popup-state.js');
const Render = require('../../popup-render.js');
const Actions = require('../../popup-actions.js');
global.Bridge = { async send() { return {}; } };
Actions.bind(State, Render);

test('Popup g_all state contains stocks without a g_all membership', () => {
  State.current.currentGroupId = 'g_all';
  State.current.searchKeyword = '';
  State.current.sortField = 'manual';
  State.current.sortDirection = 'desc';
  State.current.quoteSnapshot = { results: {} };
  State.current.watchlist = [
    { code: 'sh600519', name: '贵州茅台', groupIds: ['g_tech'], manualOrder: {}, pinned: {} }
  ];
  assert.equal(Render.getGroupStocks(State.current).length, 1);
});

test('mutation lock deduplicates the same user action', async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = Actions.withMutationLock('add-stock', async () => { calls += 1; await pending; return 1; });
  const second = Actions.withMutationLock('add-stock', async () => { calls += 1; return 2; });
  assert.equal(first, second);
  release();
  assert.equal(await first, 1);
  assert.equal(calls, 1);
});

test('mutation lock clears the slot after settling so later runs can proceed', async () => {
  let calls = 0;
  await Actions.withMutationLock('reuse-key', async () => { calls += 1; });
  await Actions.withMutationLock('reuse-key', async () => { calls += 1; });
  assert.equal(calls, 2);
  assert.equal(Actions._mutations.has('reuse-key'), false);
});

test('board patches persist per group and report failures', async () => {
  const notices = [];
  Render.toast = (message) => notices.push(message);
  State.current.boardConfig = { g_all: { viewMode: 'grid' } };
  global.Bridge = {
    async send(action, payload) {
      assert.equal(action, 'storage:saveBoardConfig');
      assert.equal(payload.groupId, 'g_all');
      return {};
    }
  };
  assert.equal(await Actions.persistBoardPatch('g_all', { sortField: 'price' }), true);
  assert.deepEqual(State.current.boardConfig.g_all, { viewMode: 'grid', sortField: 'price' });

  global.Bridge.send = async () => { throw new Error('disk full'); };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await Actions.persistBoardPatch('g_all', { sortDirection: 'asc' }), false);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(notices, ['设置保存失败，请重试']);
});

test('State.patch merges partials and notifies subscribers', () => {
  let observedKeyword = null;
  const unsubscribe = State.subscribe(() => { observedKeyword = State.current.searchKeyword; });
  State.patch({ searchKeyword: '茅台', priceHidden: true });
  assert.equal(observedKeyword, '茅台');
  assert.equal(State.current.searchKeyword, '茅台');
  assert.equal(State.current.priceHidden, true);
  unsubscribe();
  State.patch({ searchKeyword: '平安银行' });
  // 退订后 observer 不应再被触发，observedKeyword 保留退订前的最后一次值
  assert.equal(observedKeyword, '茅台');
});

test('State.init pulls groups/watchlist/boardConfig/quoteSnapshot via Bridge', async () => {
  const calls = [];
  // 为本用例隔离一份新的 Bridge，避免污染其他用例
  global.Bridge = {
    async send(action, payload) {
      calls.push({ action, payload });
      if (action === 'storage:read') {
        return { groups: [{ groupId: 'g_all', name: '全部', isDefault: true }], watchlist: [{ code: 'sh600519', name: '贵州茅台', groupIds: [] }], boardConfig: { g_all: { viewMode: 'list' } } };
      }
      if (action === 'storage:boardConfig') {
        return { sortField: 'price', sortDirection: 'desc', columns: ['name', 'price'], columnOrder: ['name', 'price'], viewMode: 'list', priceHidden: false };
      }
      if (action === 'quote:read') {
        return { results: { sh600519: { status: 'fresh', quote: { price: 1680 } } }, counts: { fresh: 1, cached: 0, missing: 0 }, attemptedAt: 1, succeededAt: 2, generation: 7 };
      }
      return {};
    }
  };
  await State.init();
  assert.deepEqual(calls.map((c) => c.action), ['storage:read', 'storage:boardConfig', 'quote:read']);
  assert.equal(State.current.groups.length, 1);
  assert.equal(State.current.watchlist.length, 1);
  assert.equal(State.current.currentGroupId, 'g_all');
  assert.equal(State.current.sortField, 'price');
  assert.equal(State.current.quoteGeneration, 7);
  assert.equal(State.current.quoteSnapshot.results.sh600519.status, 'fresh');
});

test('State.init writes manifest version when document + brand-version element exist', async () => {
  // 最小 document mock：仅覆盖 getElementById('brand-version') 的真实路径
  let versionText = '';
  global.document = {
    getElementById(id) {
      return id === 'brand-version' ? { set textContent(v) { versionText = v; }, get textContent() { return versionText; } } : null;
    }
  };
  global.chrome = { runtime: { getManifest: () => ({ version: '1.3.0' }) } };
  global.Bridge = {
    async send(action) {
      if (action === 'storage:read') return { groups: [], watchlist: [], boardConfig: {} };
      if (action === 'storage:boardConfig') return {};
      if (action === 'quote:read') return { results: {}, counts: { fresh: 0, cached: 0, missing: 0 } };
      return {};
    }
  };
  try {
    await State.init();
    assert.equal(versionText, '1.3.0');
  } finally {
    // 恢复其他用例使用的环境
    global.document = undefined;
    delete global.chrome;
  }
});
