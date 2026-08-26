// tests/unit/domain/index-quote.test.ts
// v2.1 大盘指数 — 目录形状 / 品牌构造 / 投影纯函数。
import assert from 'node:assert/strict';
import test from 'node:test';

import { INDEX_CATALOG, INDEX_CATALOG_CODES, projectIndexQuote } from '../../../src/domain/index-quote.js';
import { isIndexCode } from '../../../src/domain/stock.js';
import { normalizeStockCode } from '../../../src/domain/stock.js';
import type { Quote } from '../../../src/domain/quote.js';
import type { StockCode } from '../../../src/domain/brands.js';

test('INDEX_CATALOG holds normalized addable index codes only', () => {
  assert.ok(INDEX_CATALOG.length >= 3, '目录至少含默认三只指数');
  for (const entry of INDEX_CATALOG) {
    assert.equal(normalizeStockCode(entry.code), entry.code, `${entry.code} 可往返规范化`);
    assert.ok(isIndexCode(entry.code), `${entry.code} 落在指数段`);
    assert.ok(entry.name.length > 0, `${entry.code} 有显示名`);
  }
});

test('INDEX_CATALOG_CODES mirrors the catalog order', () => {
  assert.deepEqual(
    INDEX_CATALOG_CODES.map(String),
    INDEX_CATALOG.map((entry) => String(entry.code))
  );
});

test('isIndexCode matches only the three exchange index segments', () => {
  assert.equal(isIndexCode('sh000001'), true); // 上证指数
  assert.equal(isIndexCode('sh000300'), true); // 沪深300
  assert.equal(isIndexCode('sz399006'), true); // 创业板指
  assert.equal(isIndexCode('bj899050'), true); // 北证50
  assert.equal(isIndexCode('SH000001'), true); // 大小写不敏感
  // 相邻股票段不得误判：sh60x 股票、sz000 股票、bj83x/920 股票
  assert.equal(isIndexCode('sh600519'), false);
  assert.equal(isIndexCode('sz000001'), false);
  assert.equal(isIndexCode('bj830799'), false);
  assert.equal(isIndexCode('bj920001'), false);
});

test('projectIndexQuote strips pe/pb/limitUp/limitDown and keeps the rest', () => {
  const quote: Quote = {
    code: 'sh000001' as StockCode,
    name: '上证指数',
    price: 3901.33,
    change: 11.89,
    changePercent: 0.31,
    amount: 334_159_504_351,
    open: 3881.74,
    high: 3906.4,
    low: 3881.74,
    prevClose: 3889.44,
    volume: 196_647_792,
    turnoverRate: 0.41,
    amplitude: 0.63,
    volumeRatio: 2.44,
    pe: 0,           // 东财哨兵
    pb: 0,           // 东财哨兵
    totalMarketCap: 68_962_964_463_057,
    floatMarketCap: 61_000_631_718_705,
    limitUp: -1,     // 腾讯哨兵
    limitDown: -1    // 腾讯哨兵
  };
  const projected = projectIndexQuote(quote);
  assert.equal(projected.price, 3901.33);
  assert.equal(projected.changePercent, 0.31);
  assert.equal(projected.prevClose, 3889.44);
  assert.equal(projected.turnoverRate, 0.41);
  assert.equal(projected.amplitude, 0.63);
  assert.equal(projected.volumeRatio, 2.44);
  assert.equal(projected.totalMarketCap, 68_962_964_463_057);
  assert.equal(projected.floatMarketCap, 61_000_631_718_705);
  assert.equal(projected.pe, undefined, 'PE 剔除（0/17.70 均为假值）');
  assert.equal(projected.pb, undefined, 'PB 剔除');
  assert.equal(projected.limitUp, undefined, '涨停剔除（-1 哨兵）');
  assert.equal(projected.limitDown, undefined, '跌停剔除');
});

test('projectIndexQuote keeps undefined optional fields undefined', () => {
  const projected = projectIndexQuote({
    code: 'sz399001' as StockCode,
    name: '深证成指',
    price: 13769.35,
    change: 23.48,
    changePercent: 0.17,
    amount: 1
  });
  assert.equal('pe' in projected, false);
  assert.equal('open' in projected, false);
  assert.equal('totalMarketCap' in projected, false);
});

test('projectIndexQuote does not mutate the input quote', () => {
  const quote: Quote = {
    code: 'sh000001' as StockCode,
    name: '上证指数',
    price: 1,
    change: 0,
    changePercent: 0,
    amount: 0,
    pe: 0,
    limitUp: -1
  };
  projectIndexQuote(quote);
  assert.equal(quote.pe, 0, '输入对象未被改写');
  assert.equal(quote.limitUp, -1);
});
