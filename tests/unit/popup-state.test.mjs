import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
global.StockUtils = require('../../stock-utils.js');
global.document = undefined;
const App = require('../../popup.js');

test('Popup g_all state contains stocks without a g_all membership', () => {
  App.state.currentGroupId = 'g_all';
  App.state.searchKeyword = '';
  App.state.sortField = 'manual';
  App.state.sortDirection = 'desc';
  App.state.quoteSnapshot = { results: {} };
  App.state.watchlist = [
    { code: 'sh600519', name: '贵州茅台', groupIds: ['g_tech'], manualOrder: {}, pinned: {} }
  ];
  assert.equal(App.getGroupStocks().length, 1);
});

test('mutation lock deduplicates the same user action', async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = App.withMutationLock('add-stock', async () => { calls += 1; await pending; return 1; });
  const second = App.withMutationLock('add-stock', async () => { calls += 1; return 2; });
  assert.equal(first, second);
  release();
  assert.equal(await first, 1);
  assert.equal(calls, 1);
});

test('board patches persist per group and report failures', async () => {
  const notices = [];
  App.toast = (message) => notices.push(message);
  App.state.boardConfig = { g_all: { viewMode: 'grid' } };
  global.Bridge = {
    async send(action, payload) {
      assert.equal(action, 'storage:saveBoardConfig');
      assert.equal(payload.groupId, 'g_all');
      return {};
    }
  };
  assert.equal(await App.persistBoardPatch('g_all', { sortField: 'price' }), true);
  assert.deepEqual(App.state.boardConfig.g_all, { viewMode: 'grid', sortField: 'price' });

  global.Bridge.send = async () => { throw new Error('disk full'); };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await App.persistBoardPatch('g_all', { sortDirection: 'asc' }), false);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(notices, ['设置保存失败，请重试']);
});
