import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const QuoteFormat = require('../../quote-format.js');
const { planQuoteRequests } = require('../../background.js');

const stock = { code: 'sh600519', name: '贵州茅台' };

test('cached quote keeps its number but uses gray', () => {
  const state = QuoteFormat.formatBadgeState({
    status: 'cached',
    fetchedAt: Date.UTC(2026, 6, 31, 6, 32),
    quote: { changePercent: -2.5, price: 10 }
  });
  assert.deepEqual(state, { text: '2.5', color: '#95A5A6' });
});

test('cached Tooltip explicitly includes age', () => {
  const line = QuoteFormat.formatTooltipLine(stock, {
    status: 'cached',
    fetchedAt: Date.UTC(2026, 6, 31, 6, 32),
    quote: { name: '贵州茅台', changePercent: -2.5, change: -1, price: 10 }
  });
  assert.match(line, /已过期/);
  assert.match(line, /14:32/);
});

test('missing quote uses a gray double dash', () => {
  assert.deepEqual(
    QuoteFormat.formatBadgeState({ status: 'missing', fetchedAt: null, quote: null }),
    { text: '--', color: '#95A5A6' }
  );
});

test('non-quote sorts read all caches but refresh only the tooltip window', () => {
  const stocks = Array.from({ length: 8 }, (_, index) => ({ code: `sh60000${index}` }));
  const manual = planQuoteRequests(stocks, 'manual');
  assert.deepEqual(manual.readCodes, stocks.map((item) => item.code));
  assert.deepEqual(manual.refreshCodes, stocks.slice(0, 5).map((item) => item.code));
  const price = planQuoteRequests(stocks, 'price');
  assert.deepEqual(price.readCodes, stocks.map((item) => item.code));
  assert.deepEqual(price.refreshCodes, stocks.map((item) => item.code));
  assert.deepEqual(planQuoteRequests([], 'manual').readCodes, []);
});
