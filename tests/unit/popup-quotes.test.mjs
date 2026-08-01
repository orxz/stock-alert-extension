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

test('older quote generations cannot overwrite newer state', () => {
  State.current.quoteGeneration = 2;
  const applied = Actions.applyQuoteSnapshot({
    generation: 1,
    results: {},
    counts: { fresh: 0, cached: 0, missing: 0 },
    attemptedAt: 1,
    succeededAt: null
  });
  assert.equal(applied, false);
  assert.equal(State.current.quoteGeneration, 2);
});

test('newer quote generation overwrites state and bumps the counter', () => {
  State.current.quoteGeneration = 2;
  State.current.quoteSnapshot = { results: {}, counts: { fresh: 0, cached: 0, missing: 0 }, attemptedAt: 1, succeededAt: null };
  const applied = Actions.applyQuoteSnapshot({
    generation: 5,
    results: { sh600519: { status: 'fresh', quote: { price: 1680 } } },
    counts: { fresh: 1, cached: 0, missing: 0 },
    attemptedAt: 10,
    succeededAt: 11
  });
  assert.equal(applied, true);
  assert.equal(State.current.quoteGeneration, 5);
  assert.equal(State.current.quoteSnapshot.results.sh600519.status, 'fresh');
});

test('snapshot without generation field is accepted and resets counter to 0', () => {
  State.current.quoteGeneration = 0;
  const applied = Actions.applyQuoteSnapshot({
    results: {},
    counts: { fresh: 0, cached: 0, missing: 0 },
    attemptedAt: 1,
    succeededAt: null
  });
  assert.equal(applied, true);
  assert.equal(State.current.quoteGeneration, 0);
});

test('refreshQuotes applies fresh snapshot and triggers status/time update', async () => {
  State.current.watchlist = [{ code: 'sh600519', name: '贵州茅台', groupIds: [] }];
  State.current.quoteGeneration = 0;
  let statusCalls = 0;
  let timeCalls = 0;
  Render.updateQuoteStatus = () => { statusCalls += 1; };
  Render.updateTimeLabel = () => { timeCalls += 1; };
  global.Bridge = {
    async send(action, payload) {
      assert.equal(action, 'quote:refresh');
      assert.deepEqual(payload, { codes: ['sh600519'], force: false });
      return { generation: 3, results: { sh600519: { status: 'fresh', quote: { price: 1680 } } }, counts: { fresh: 1, cached: 0, missing: 0 }, attemptedAt: 1, succeededAt: 2 };
    }
  };
  const snapshot = await Actions.refreshQuotes();
  assert.equal(snapshot.generation, 3);
  assert.equal(State.current.quoteGeneration, 3);
  assert.equal(statusCalls, 1);
  assert.equal(timeCalls, 1);
});

test('cleanup clears scheduled timers without throwing', () => {
  Actions._quoteTimer = setTimeout(() => {}, 1000);
  Actions._timeTimer = setInterval(() => {}, 1000);
  Actions.cleanup();
  assert.equal(Actions._quoteTimer, null);
  assert.equal(Actions._timeTimer, null);
});

test('Render.esc escapes HTML-special characters and tolerates null', () => {
  assert.equal(Render.esc('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(Render.esc("a'b&c"), 'a&#39;b&amp;c');
  assert.equal(Render.esc(null), '');
  assert.equal(Render.esc(undefined), '');
});

test('Render.getStockMeta resolves known hot stocks and returns null for unknown', () => {
  assert.equal(Render.getStockMeta('sh600519').name, '贵州茅台');
  assert.equal(Render.getStockMeta('sh600519').pinyin, 'gzmt');
  assert.equal(Render.getStockMeta('sh000999'), null);
});

test('Render.getGroupStocks filters by keyword across code/pinyin/name/tag', () => {
  State.current.currentGroupId = 'g_all';
  State.current.searchKeyword = '';
  State.current.sortField = 'manual';
  State.current.sortDirection = 'desc';
  State.current.quoteSnapshot = { results: {} };
  State.current.watchlist = [
    { code: 'sh600519', name: '贵州茅台', groupIds: [], manualOrder: {}, pinned: {} },
    { code: 'sz000001', name: '平安银行', groupIds: [], manualOrder: {}, pinned: {} }
  ];
  assert.equal(Render.getGroupStocks(State.current).length, 2);

  State.current.searchKeyword = 'gzmt'; // 拼音命中茅台
  assert.deepEqual(Render.getGroupStocks(State.current).map((s) => s.code), ['sh600519']);

  State.current.searchKeyword = '600'; // 代码前缀命中
  assert.deepEqual(Render.getGroupStocks(State.current).map((s) => s.code), ['sh600519']);

  State.current.searchKeyword = '银行'; // 行业/名称命中平安银行
  assert.deepEqual(Render.getGroupStocks(State.current).map((s) => s.code), ['sz000001']);

  State.current.searchKeyword = '';
});

test('Render.getGroupStocks respects custom group membership', () => {
  State.current.currentGroupId = 'g_tech';
  State.current.searchKeyword = '';
  State.current.watchlist = [
    { code: 'sh600519', name: '贵州茅台', groupIds: ['g_tech'], manualOrder: { g_tech: 0 }, pinned: {} },
    { code: 'sz000001', name: '平安银行', groupIds: [], manualOrder: {}, pinned: {} }
  ];
  assert.deepEqual(Render.getGroupStocks(State.current).map((s) => s.code), ['sh600519']);
  State.current.currentGroupId = 'g_all';
});
