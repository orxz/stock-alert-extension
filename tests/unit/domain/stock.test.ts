// tests/unit/domain/stock.test.ts
// Task 4 Step 1 — normalizeStockCode 与 stocksForGroup 的纯领域规则测试。
import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeStockCode } from '../../../src/domain/stock.js';
import { stocksForGroup } from '../../../src/domain/portfolio.js';

test('normalizes supported A-share markets only', () => {
  assert.equal(normalizeStockCode('600519'), 'sh600519');
  assert.equal(normalizeStockCode('300750'), 'sz300750');
  assert.equal(normalizeStockCode('920001'), 'bj920001');
  assert.equal(normalizeStockCode('hk00700'), null);
});

test('g_all is computed without persisted membership', () => {
  const stocks = [{ code: 'sh600519', name: '贵州茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 1 }];
  assert.equal(stocksForGroup(stocks, 'g_all').length, 1);
  assert.equal(stocks[0].groupIds.includes('g_all'), false);
});

test('normalizeStockCode accepts explicit market prefixes', () => {
  assert.equal(normalizeStockCode('sh600519'), 'sh600519');
  assert.equal(normalizeStockCode('sz000001'), 'sz000001');
  assert.equal(normalizeStockCode('bj920001'), 'bj920001');
});

test('normalizeStockCode rejects explicit prefix that conflicts with inferred market', () => {
  assert.equal(normalizeStockCode('sz600519'), null);
  assert.equal(normalizeStockCode('sh000001'), null);
  assert.equal(normalizeStockCode('bj600519'), null);
});

test('normalizeStockCode covers all supported prefixes case-insensitively', () => {
  // sh: 600/601/603/605/688/689
  assert.equal(normalizeStockCode('600000'), 'sh600000');
  assert.equal(normalizeStockCode('601318'), 'sh601318');
  assert.equal(normalizeStockCode('603160'), 'sh603160');
  assert.equal(normalizeStockCode('605555'), 'sh605555');
  assert.equal(normalizeStockCode('688981'), 'sh688981');
  assert.equal(normalizeStockCode('689009'), 'sh689009');
  // sz: 000/001/002/003/300/301
  assert.equal(normalizeStockCode('000002'), 'sz000002');
  assert.equal(normalizeStockCode('001872'), 'sz001872');
  assert.equal(normalizeStockCode('002594'), 'sz002594');
  assert.equal(normalizeStockCode('003816'), 'sz003816');
  assert.equal(normalizeStockCode('300750'), 'sz300750');
  assert.equal(normalizeStockCode('301308'), 'sz301308');
  // bj: 4/8/920
  assert.equal(normalizeStockCode('430047'), 'bj430047');
  assert.equal(normalizeStockCode('830799'), 'bj830799');
  assert.equal(normalizeStockCode('920001'), 'bj920001');
});

test('normalizeStockCode rejects unsupported formats', () => {
  assert.equal(normalizeStockCode('12345'), null); // 非 6 位
  assert.equal(normalizeStockCode('1234567'), null); // 非 6 位
  assert.equal(normalizeStockCode('abc123'), null); // 非纯数字
  assert.equal(normalizeStockCode('hk00700'), null); // 非沪深北
  assert.equal(normalizeStockCode('usAAPL'), null); // 非沪深北
  assert.equal(normalizeStockCode(''), null);
  assert.equal(normalizeStockCode(null), null);
  assert.equal(normalizeStockCode(undefined), null);
  assert.equal(normalizeStockCode(600519), 'sh600519'); // 数字输入
  assert.equal(normalizeStockCode(' SH600519 '), 'sh600519'); // 大小写 + 空格
});

test('normalizeStockCode rejects unsupported 6-digit ranges', () => {
  assert.equal(normalizeStockCode('200000'), null); // B 股不在支持范围
  assert.equal(normalizeStockCode('500000'), null); // 基金不在支持范围
  assert.equal(normalizeStockCode('700000'), null); // 不支持
});

test('stocksForGroup filters by groupIds for custom groups', () => {
  const stocks = [
    { code: 'sh600519', name: 'A', groupIds: ['g1'], manualOrder: {}, pinned: {}, addedAt: 1 },
    { code: 'sz000001', name: 'B', groupIds: ['g2'], manualOrder: {}, pinned: {}, addedAt: 2 },
    { code: 'sz300750', name: 'C', groupIds: ['g1', 'g2'], manualOrder: {}, pinned: {}, addedAt: 3 }
  ];
  assert.equal(stocksForGroup(stocks, 'g_all').length, 3);
  assert.equal(stocksForGroup(stocks, 'g1').length, 2);
  assert.equal(stocksForGroup(stocks, 'g2').length, 2);
  assert.equal(stocksForGroup(stocks, 'g3').length, 0);
});

test('stocksForGroup returns a copy (does not mutate input)', () => {
  const stocks = [{ code: 'sh600519', name: 'A', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 1 }];
  const result = stocksForGroup(stocks, 'g_all');
  assert.notEqual(result, stocks);
  assert.equal(result.length, stocks.length);
});
