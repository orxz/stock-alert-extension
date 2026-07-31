import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
global.StockUtils = require('../../stock-utils.js');
const { formatBadgeState, formatTooltipLine } = require('../../background.js');

const stock = { code: 'sh600519', name: '贵州茅台' };

test('cached quote keeps its number but uses gray', () => {
  const state = formatBadgeState(stock, {
    status: 'cached',
    fetchedAt: Date.UTC(2026, 6, 31, 6, 32),
    quote: { changePercent: -2.5, price: 10 }
  });
  assert.deepEqual(state, { text: '2.5', color: '#95A5A6' });
});

test('cached Tooltip explicitly includes age', () => {
  const line = formatTooltipLine(stock, {
    status: 'cached',
    fetchedAt: Date.UTC(2026, 6, 31, 6, 32),
    quote: { name: '贵州茅台', changePercent: -2.5, change: -1, price: 10 }
  });
  assert.match(line, /已过期/);
  assert.match(line, /14:32/);
});

test('missing quote uses a gray double dash', () => {
  assert.deepEqual(
    formatBadgeState(stock, { status: 'missing', fetchedAt: null, quote: null }),
    { text: '--', color: '#95A5A6' }
  );
});
