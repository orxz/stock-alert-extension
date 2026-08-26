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
  // sh000001 不再是冲突：v2.1 起显式 sh + 000xxx 归沪市指数（上证指数）。
  // 真正的冲突示例换成 sh399001（深市指数段配沪前缀）。
  assert.equal(normalizeStockCode('sh399001'), null);
  assert.equal(normalizeStockCode('bj600519'), null);
});

test('normalizeStockCode accepts exchange index codes (v2.1)', () => {
  // 显式前缀：sh000xxx / sz399xxx / bj899xxx 归指数段
  assert.equal(normalizeStockCode('sh000001'), 'sh000001'); // 上证指数
  assert.equal(normalizeStockCode('sh000300'), 'sh000300'); // 沪深300
  assert.equal(normalizeStockCode('sz399001'), 'sz399001'); // 深证成指
  assert.equal(normalizeStockCode('sz399006'), 'sz399006'); // 创业板指
  assert.equal(normalizeStockCode('bj899050'), 'bj899050'); // 北证50
});

test('normalizeStockCode keeps bare 000xxx as sz stock for v1 compatibility', () => {
  // 裸 000xxx 仍归深市股票（sz000001=平安银行）：存量代码语义不翻转。
  assert.equal(normalizeStockCode('000001'), 'sz000001');
  assert.equal(normalizeStockCode('000300'), 'sz000300');
  // 裸 399/899 无股票歧义：直接归指数段。
  assert.equal(normalizeStockCode('399001'), 'sz399001');
  assert.equal(normalizeStockCode('899050'), 'bj899050');
});

test('normalizeStockCode covers all supported prefixes case-insensitively', () => {
  // sh: 600/601/603/605/688/689
  assert.equal(normalizeStockCode('600000'), 'sh600000');
  assert.equal(normalizeStockCode('601318'), 'sh601318');
  assert.equal(normalizeStockCode('603160'), 'sh603160');
  assert.equal(normalizeStockCode('605555'), 'sh605555');
  assert.equal(normalizeStockCode('688981'), 'sh688981');
  assert.equal(normalizeStockCode('689009'), 'sh689009');
  // sz: 000/001/002/003/300/301/302（302 为 2025 年深交所创业板新增代码段，如中航成飞 302132）
  assert.equal(normalizeStockCode('000002'), 'sz000002');
  assert.equal(normalizeStockCode('001872'), 'sz001872');
  assert.equal(normalizeStockCode('002594'), 'sz002594');
  assert.equal(normalizeStockCode('003816'), 'sz003816');
  assert.equal(normalizeStockCode('300750'), 'sz300750');
  assert.equal(normalizeStockCode('301308'), 'sz301308');
  assert.equal(normalizeStockCode('302132'), 'sz302132');
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
