// tests/unit/domain/portfolio.test.ts
// Task 4 Step 5 — sortStocks 纯排序规则测试（各字段/方向/pinned 优先/缺失排末尾/稳定）。
import assert from 'node:assert/strict';
import test from 'node:test';

import { sortStocks } from '../../../src/domain/portfolio.js';

// 构造一个空 QuoteSnapshot，results 可按需补充。
function snapshot(results) {
  return { results: results || {}, counts: { fresh: 0, cached: 0, missing: 0 }, attemptedAt: 0, succeededAt: null, generation: 0 };
}

function mkStock(code, name, extra) {
  return Object.assign({ code, name, groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }, extra || {});
}

test('sortStocks keeps pinned stocks first regardless of field', () => {
  const stocks = [
    mkStock('sh600519', '茅台', { pinned: { g1: false }, addedAt: 5 }),
    mkStock('sz000001', '平安', { pinned: { g1: true }, addedAt: 1 }),
    mkStock('sz300750', '宁德', { pinned: { g1: false }, addedAt: 3 })
  ];
  const sorted = sortStocks(stocks, snapshot(), 'g1', { sortField: 'addedAt', sortDirection: 'asc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sz000001', 'sz300750', 'sh600519']);
});

test('sortStocks manual uses manualOrder and ignores direction', () => {
  const stocks = [
    mkStock('sh600519', '茅台', { manualOrder: { g1: 2 } }),
    mkStock('sz000001', '平安', { manualOrder: { g1: 0 } }),
    mkStock('sz300750', '宁德', { manualOrder: { g1: 1 } }),
    mkStock('bj920001', '北交', {}) // 缺省排末尾 9999
  ];
  // asc
  let sorted = sortStocks(stocks, snapshot(), 'g1', { sortField: 'manual', sortDirection: 'asc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sz000001', 'sz300750', 'sh600519', 'bj920001']);
  // desc — manual 不受 direction 影响，仍然升序
  sorted = sortStocks(stocks, snapshot(), 'g1', { sortField: 'manual', sortDirection: 'desc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sz000001', 'sz300750', 'sh600519', 'bj920001']);
});

test('sortStocks addedAt asc puts older first, desc puts newer first', () => {
  const stocks = [
    mkStock('sh600519', '茅台', { addedAt: 3000 }),
    mkStock('sz000001', '平安', { addedAt: 1000 }),
    mkStock('sz300750', '宁德', { addedAt: 2000 })
  ];
  let sorted = sortStocks(stocks, snapshot(), 'g1', { sortField: 'addedAt', sortDirection: 'asc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sz000001', 'sz300750', 'sh600519']);
  sorted = sortStocks(stocks, snapshot(), 'g1', { sortField: 'addedAt', sortDirection: 'desc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sh600519', 'sz300750', 'sz000001']);
});

test('sortStocks name respects direction via localeCompare', () => {
  const stocks = [
    mkStock('sh600519', '茅台'),
    mkStock('sz000001', '平安'),
    mkStock('sz300750', '宁德')
  ];
  let sorted = sortStocks(stocks, snapshot(), 'g1', { sortField: 'name', sortDirection: 'asc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sz300750', 'sz000001', 'sh600519']); // 宁 < 平 < 茅（localeCompare）
  sorted = sortStocks(stocks, snapshot(), 'g1', { sortField: 'name', sortDirection: 'desc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sh600519', 'sz000001', 'sz300750']);
});

test('sortStocks addedAt handles falsy (0) values via || 0 fallback', () => {
  const stocks = [
    mkStock('sh600519', '茅台', { addedAt: 0 }),  // falsy → 0
    mkStock('sz000001', '平安', { addedAt: 100 })
  ];
  const sorted = sortStocks(stocks, snapshot(), 'g1', { sortField: 'addedAt', sortDirection: 'asc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sh600519', 'sz000001']); // 0 < 100
});

test('sortStocks name handles falsy (empty) values via || fallback', () => {
  const stocks = [
    mkStock('sh600519', '', {}),       // falsy name → ''
    mkStock('sz000001', '平安', {})
  ];
  const sorted = sortStocks(stocks, snapshot(), 'g1', { sortField: 'name', sortDirection: 'asc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sh600519', 'sz000001']); // '' < '平安'
});

test('sortStocks price/change/changePercent/amount read from quotes.results[code].quote[field]', () => {
  const stocks = [
    mkStock('sh600519', '茅台'),
    mkStock('sz000001', '平安'),
    mkStock('sz300750', '宁德')
  ];
  const quotes = snapshot({
    sh600519: { code: 'sh600519', status: 'fresh', source: 'eastmoney', provider: 'eastmoney', fetchedAt: 0, error: null, quote: { code: 'sh600519', name: '茅台', price: 1500, change: 12, changePercent: 0.8, amount: 100 } },
    sz000001: { code: 'sz000001', status: 'fresh', source: 'eastmoney', provider: 'eastmoney', fetchedAt: 0, error: null, quote: { code: 'sz000001', name: '平安', price: 10, change: -1, changePercent: -2.5, amount: 300 } },
    sz300750: { code: 'sz300750', status: 'fresh', source: 'eastmoney', provider: 'eastmoney', fetchedAt: 0, error: null, quote: { code: 'sz300750', name: '宁德', price: 200, change: 5, changePercent: 1.2, amount: 200 } }
  });
  // price asc
  let sorted = sortStocks(stocks, quotes, 'g1', { sortField: 'price', sortDirection: 'asc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sz000001', 'sz300750', 'sh600519']);
  // price desc
  sorted = sortStocks(stocks, quotes, 'g1', { sortField: 'price', sortDirection: 'desc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sh600519', 'sz300750', 'sz000001']);
  // changePercent asc
  sorted = sortStocks(stocks, quotes, 'g1', { sortField: 'changePercent', sortDirection: 'asc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sz000001', 'sh600519', 'sz300750']);
  // amount desc
  sorted = sortStocks(stocks, quotes, 'g1', { sortField: 'amount', sortDirection: 'desc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sz000001', 'sz300750', 'sh600519']);
});

test('sortStocks places missing quote values last in both directions', () => {
  const stocks = [
    mkStock('sh600519', '茅台'),
    mkStock('sz000001', '平安'), // 无行情
    mkStock('sz300750', '宁德')
  ];
  const quotes = snapshot({
    sh600519: { code: 'sh600519', status: 'fresh', source: 'eastmoney', provider: 'eastmoney', fetchedAt: 0, error: null, quote: { code: 'sh600519', name: '茅台', price: 1500, change: 12, changePercent: 0.8, amount: 100 } },
    sz300750: { code: 'sz300750', status: 'fresh', source: 'eastmoney', provider: 'eastmoney', fetchedAt: 0, error: null, quote: { code: 'sz300750', name: '宁德', price: 200, change: 5, changePercent: 1.2, amount: 200 } }
  });
  let sorted = sortStocks(stocks, quotes, 'g1', { sortField: 'price', sortDirection: 'asc' });
  assert.equal(sorted[sorted.length - 1].code, 'sz000001'); // 缺失排末尾
  sorted = sortStocks(stocks, quotes, 'g1', { sortField: 'price', sortDirection: 'desc' });
  assert.equal(sorted[sorted.length - 1].code, 'sz000001'); // 缺失排末尾
});

test('sortStocks is stable when both values are missing', () => {
  const stocks = [
    mkStock('sh600519', '茅台'),
    mkStock('sz000001', '平安')
  ];
  // 两者都无行情 — 保持原始顺序（稳定）
  const sorted = sortStocks(stocks, snapshot(), 'g1', { sortField: 'price', sortDirection: 'asc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sh600519', 'sz000001']);
});

test('sortStocks does not mutate the input array', () => {
  const stocks = [
    mkStock('sh600519', 'B'),
    mkStock('sz000001', 'A')
  ];
  const original = [...stocks];
  sortStocks(stocks, snapshot(), 'g1', { sortField: 'name', sortDirection: 'asc' });
  assert.deepEqual(stocks.map((s) => s.code), original.map((s) => s.code));
});

test('sortStocks respects pinned for the specific groupId only', () => {
  const stocks = [
    mkStock('sh600519', '茅台', { pinned: { g1: true } }),
    mkStock('sz000001', '平安', { pinned: { g2: true } }) // pinned 在 g2 不在 g1
  ];
  const sorted = sortStocks(stocks, snapshot(), 'g1', { sortField: 'name', sortDirection: 'asc' });
  assert.deepEqual(sorted.map((s) => s.code), ['sh600519', 'sz000001']); // 茅台 pinned 在 g1 先
});

// ===== stocksForGroup =====

import { stocksForGroup } from '../../../src/domain/portfolio.js';

test('stocksForGroup returns all stocks for g_all without filtering', () => {
  const stocks = [
    mkStock('sh600519', '茅台', { groupIds: ['g1'] }),
    mkStock('sz000001', '平安', { groupIds: ['g2'] }),
    mkStock('bj920001', '诺思兰德', { groupIds: [] })
  ];
  // g_all 返回全部，不管 groupIds
  const result = stocksForGroup(stocks, 'g_all');
  assert.equal(result.length, 3);
});

test('stocksForGroup filters by groupId for custom groups', () => {
  const stocks = [
    mkStock('sh600519', '茅台', { groupIds: ['g1', 'g2'] }),
    mkStock('sz000001', '平安', { groupIds: ['g2'] }),
    mkStock('bj920001', '诺思兰德', { groupIds: [] })
  ];
  // g1 只有茅台
  assert.deepEqual(stocksForGroup(stocks, 'g1').map((s) => s.code), ['sh600519']);
  // g2 有茅台和平安
  assert.deepEqual(stocksForGroup(stocks, 'g2').map((s) => s.code), ['sh600519', 'sz000001']);
  // 空分组返回空数组
  assert.deepEqual(stocksForGroup(stocks, 'g3'), []);
});

test('stocksForGroup returns a copy, not the original array', () => {
  const stocks = [mkStock('sh600519', '茅台', { groupIds: ['g1'] })];
  const result = stocksForGroup(stocks, 'g_all');
  assert.notEqual(result, stocks);
  result.push(mkStock('sz000001', '平安', {}));
  assert.equal(stocks.length, 1); // 原数组不受影响
});
