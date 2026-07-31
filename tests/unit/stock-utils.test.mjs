import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const StockUtils = require('../../stock-utils.js');
const rootDir = new URL('../../', import.meta.url);

const stocks = [
  { code: 'sh600519', groupIds: ['g_value'], pinned: {}, manualOrder: { g_all: 1 }, addedAt: 2 },
  { code: 'sz000001', groupIds: [], pinned: {}, manualOrder: { g_all: 0 }, addedAt: 1 }
];

test('g_all is the complete watchlist without membership flags', () => {
  assert.deepEqual(StockUtils.getStocksForGroup(stocks, 'g_all').map((stock) => stock.code), ['sh600519', 'sz000001']);
  assert.equal(StockUtils.countStocksForGroup(stocks, 'g_all'), 2);
});

test('custom group uses groupIds only', () => {
  assert.deepEqual(StockUtils.getStocksForGroup(stocks, 'g_value').map((stock) => stock.code), ['sh600519']);
});

test('normalizes only supported six-digit A-share prefixes', () => {
  assert.equal(StockUtils.normalizeStockCode(' 600519 '), 'sh600519');
  assert.equal(StockUtils.normalizeStockCode('920185'), 'bj920185');
  assert.equal(StockUtils.normalizeStockCode('sz000001'), 'sz000001');
  assert.equal(StockUtils.normalizeStockCode('120001'), null);
});

test('missing quote values remain last in both directions', () => {
  const results = {
    sh600519: { status: 'fresh', quote: { price: 10 } },
    sz000001: { status: 'missing', quote: null }
  };
  assert.equal(StockUtils.sortStocks(stocks, results, 'g_all', 'price', 'asc')[1].code, 'sz000001');
  assert.equal(StockUtils.sortStocks(stocks, results, 'g_all', 'price', 'desc')[1].code, 'sz000001');
});

test('runtime entry points load StockUtils before storage consumers', async () => {
  const popup = await readFile(new URL('popup.html', rootDir), 'utf8');
  const background = await readFile(new URL('background.js', rootDir), 'utf8');
  assert.ok(popup.indexOf('src="stock-utils.js"') < popup.indexOf('src="storage.js"'));
  assert.match(background, /importScripts\('stock-utils\.js', 'storage\.js', 'quotes\.js'(?:, '[^']+')*\)/);
});

test('normalization rejects malformed, unsupported, and mismatched markets', () => {
  assert.equal(StockUtils.normalizeStockCode(''), null);
  assert.equal(StockUtils.normalizeStockCode('123'), null);
  assert.equal(StockUtils.normalizeStockCode('sh000001'), null);
  assert.equal(StockUtils.normalizeStockCode('600519x'), null);
  assert.equal(StockUtils.normalizeStockCode('688001'), 'sh688001');
  assert.equal(StockUtils.normalizeStockCode('301001'), 'sz301001');
  assert.equal(StockUtils.normalizeStockCode('830001'), 'bj830001');
});

test('sorting keeps pinned stocks first and supports every local field', () => {
  const input = [
    { code: 'a', name: '乙', addedAt: 2, groupIds: [], pinned: {}, manualOrder: { g_all: 1 } },
    { code: 'b', name: '甲', addedAt: 1, groupIds: [], pinned: { g_all: true }, manualOrder: { g_all: 2 } },
    { code: 'c', name: '丙', addedAt: 3, groupIds: [], pinned: {}, manualOrder: {} }
  ];
  assert.equal(StockUtils.sortStocks(input, {}, 'g_all', 'manual', 'asc')[0].code, 'b');
  assert.equal(StockUtils.sortStocks(input, {}, 'g_all', 'addedAt', 'desc')[1].code, 'c');
  assert.equal(StockUtils.sortStocks(input, {}, 'g_all', 'name', 'asc')[0].code, 'b');
  assert.deepEqual(input.map((stock) => stock.code), ['a', 'b', 'c']);
});

test('group helpers tolerate invalid collections', () => {
  assert.deepEqual(StockUtils.getStocksForGroup(null, 'g_all'), []);
  assert.equal(StockUtils.countStocksForGroup(null, 'g_all'), 0);
});
