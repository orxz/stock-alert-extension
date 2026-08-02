// tests/unit/popup-render.test.mjs — popup-render.js 纯函数单测
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

// popup-render.js 依赖全局 StockUtils（纯函数不依赖 DOM）
global.StockUtils = require('../../stock-utils.js');
global.document = undefined; // 阻止模块顶层执行 DOM 操作
const Render = require('../../popup-render.js');

test('esc escapes HTML-special characters and tolerates null', () => {
  assert.equal(Render.esc(null), '');
  assert.equal(Render.esc(undefined), '');
  assert.equal(Render.esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(Render.esc('a "b" & \'c\''), 'a &quot;b&quot; &amp; &#39;c&#39;');
  assert.equal(Render.esc('正常文本'), '正常文本');
});

test('getStockMeta resolves known hot stocks and returns null for unknown', () => {
  // 已知热门
  const moutai = Render.getStockMeta('sh600519');
  assert.ok(moutai);
  assert.equal(moutai.name, '贵州茅台');
  assert.equal(moutai.pinyin, 'gzmt');
  assert.equal(moutai.tag, '白酒');
  // 未知
  assert.equal(Render.getStockMeta('sh999999'), null);
});

test('getGroupStocks filters by keyword across code/pinyin/name/tag', () => {
  const state = {
    watchlist: [
      { code: 'sh600519', name: '贵州茅台', groupIds: [], manualOrder: {}, pinned: {} },
      { code: 'sz000001', name: '平安银行', groupIds: [], manualOrder: {}, pinned: {} }
    ],
    currentGroupId: 'g_all',
    searchKeyword: '茅台',
    sortField: 'manual',
    sortDirection: 'desc',
    quoteSnapshot: { results: {} }
  };
  const stocks = Render.getGroupStocks(state);
  assert.equal(stocks.length, 1);
  assert.equal(stocks[0].code, 'sh600519');
});

test('getGroupStocks matches by pinyin prefix', () => {
  const state = {
    watchlist: [
      { code: 'sh600519', name: '贵州茅台', groupIds: [], manualOrder: {}, pinned: {} },
      { code: 'sz000001', name: '平安银行', groupIds: [], manualOrder: {}, pinned: {} }
    ],
    currentGroupId: 'g_all',
    searchKeyword: 'gzmt',
    sortField: 'manual',
    sortDirection: 'desc',
    quoteSnapshot: { results: {} }
  };
  const stocks = Render.getGroupStocks(state);
  assert.equal(stocks.length, 1);
  assert.equal(stocks[0].code, 'sh600519');
});

test('getGroupStocks matches by numeric code', () => {
  const state = {
    watchlist: [
      { code: 'sh600519', name: '贵州茅台', groupIds: [], manualOrder: {}, pinned: {} },
      { code: 'sz000001', name: '平安银行', groupIds: [], manualOrder: {}, pinned: {} }
    ],
    currentGroupId: 'g_all',
    searchKeyword: '600519',
    sortField: 'manual',
    sortDirection: 'desc',
    quoteSnapshot: { results: {} }
  };
  const stocks = Render.getGroupStocks(state);
  assert.equal(stocks.length, 1);
  assert.equal(stocks[0].code, 'sh600519');
});

test('getGroupStocks respects custom group membership', () => {
  const state = {
    watchlist: [
      { code: 'sh600519', name: '贵州茅台', groupIds: ['g_tech'], manualOrder: {}, pinned: {} },
      { code: 'sz000001', name: '平安银行', groupIds: [], manualOrder: {}, pinned: {} }
    ],
    currentGroupId: 'g_tech',
    searchKeyword: '',
    sortField: 'manual',
    sortDirection: 'desc',
    quoteSnapshot: { results: {} }
  };
  const stocks = Render.getGroupStocks(state);
  assert.equal(stocks.length, 1);
  assert.equal(stocks[0].code, 'sh600519');
});

test('getGroupStocks returns empty for no matches', () => {
  const state = {
    watchlist: [
      { code: 'sh600519', name: '贵州茅台', groupIds: [], manualOrder: {}, pinned: {} }
    ],
    currentGroupId: 'g_all',
    searchKeyword: 'xyz不存在的股票',
    sortField: 'manual',
    sortDirection: 'desc',
    quoteSnapshot: { results: {} }
  };
  assert.equal(Render.getGroupStocks(state).length, 0);
});
