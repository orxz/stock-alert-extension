import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
global.StockUtils = require('../../stock-utils.js');
global.document = undefined;
const App = require('../../popup.js');

test('summarizes mixed live and cached data', () => {
  assert.equal(
    App.formatStatusSummary({ counts: { fresh: 8, cached: 2, missing: 0 } }),
    '实时 8 · 缓存 2'
  );
});

test('summary includes the missing count and keeps actionable hints', () => {
  assert.equal(
    App.formatStatusSummary({ counts: { fresh: 8, cached: 2, missing: 1 } }),
    '实时 8 · 缓存 2 · 缺失 1'
  );
  assert.equal(
    App.formatStatusSummary({ counts: { fresh: 0, cached: 2, missing: 3 } }),
    '缓存 2 · 缺失 3 · 行情服务暂不可用'
  );
  assert.equal(
    App.formatStatusSummary({ counts: { fresh: 0, cached: 0, missing: 5 } }),
    '无行情数据 · 点击刷新重试'
  );
  assert.equal(App.formatStatusSummary({ counts: {} }), '暂无自选股');
});

test('cached quote keeps the value and exposes an old marker', () => {
  const display = App.getQuoteDisplay({
    status: 'cached',
    fetchedAt: Date.UTC(2026, 6, 31, 6, 32),
    quote: { price: 10, change: 1, changePercent: 11.11 }
  });
  assert.equal(display.price, '10.00');
  assert.equal(display.status, 'cached');
  assert.match(display.staleLabel, /^旧 /);
});

test('missing quote never displays zero', () => {
  const display = App.getQuoteDisplay({ status: 'missing', fetchedAt: null, quote: null });
  assert.equal(display.price, '--');
  assert.equal(display.change, '--');
});

test('older quote generations cannot overwrite newer state', () => {
  App.state.quoteGeneration = 2;
  const applied = App.applyQuoteSnapshot({
    generation: 1,
    results: {},
    counts: { fresh: 0, cached: 0, missing: 0 },
    attemptedAt: 1,
    succeededAt: null
  });
  assert.equal(applied, false);
  assert.equal(App.state.quoteGeneration, 2);
});
