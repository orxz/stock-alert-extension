import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const QuoteFormat = require('../../quote-format.js');

test('formatStatusSummary shows live and cached counts', () => {
  assert.equal(
    QuoteFormat.formatStatusSummary({ counts: { fresh: 8, cached: 2, missing: 0 } }),
    '实时 8 · 缓存 2'
  );
});

test('formatStatusSummary shows missing and actionable hints', () => {
  assert.equal(
    QuoteFormat.formatStatusSummary({ counts: { fresh: 0, cached: 2, missing: 3 } }),
    '缓存 2 · 缺失 3 · 行情服务暂不可用'
  );
  assert.equal(
    QuoteFormat.formatStatusSummary({ counts: { fresh: 0, cached: 0, missing: 5 } }),
    '无行情数据 · 点击刷新重试'
  );
  assert.equal(QuoteFormat.formatStatusSummary({ counts: {} }), '暂无自选股');
});

test('getQuoteDisplay formats cached quote with stale label', () => {
  const display = QuoteFormat.getQuoteDisplay({
    status: 'cached',
    fetchedAt: Date.UTC(2026, 6, 31, 6, 32),
    quote: { price: 10, change: 1, changePercent: 11.11 }
  });
  assert.equal(display.price, '10.00');
  assert.equal(display.status, 'cached');
  assert.match(display.staleLabel, /^旧 /);
});

test('getQuoteDisplay shows -- for missing quote', () => {
  const display = QuoteFormat.getQuoteDisplay({ status: 'missing', fetchedAt: null, quote: null });
  assert.equal(display.price, '--');
  assert.equal(display.change, '--');
});

test('formatUpdateTime formats in Asia/Shanghai', () => {
  assert.equal(QuoteFormat.formatUpdateTime(Date.UTC(2026, 6, 31, 6, 32)), '14:32 更新');
});

test('formatRelativeTime shows 刚刚更新 within 5 seconds', () => {
  const now = Date.UTC(2026, 6, 31, 6, 32, 0);
  assert.equal(QuoteFormat.formatRelativeTime(now, now), '刚刚更新');
  assert.equal(QuoteFormat.formatRelativeTime(now - 4 * 1000, now), '刚刚更新');
});

test('formatRelativeTime shows N 秒前更新 under 60 seconds', () => {
  const now = Date.UTC(2026, 6, 31, 6, 32, 0);
  assert.equal(QuoteFormat.formatRelativeTime(now - 5 * 1000, now), '5 秒前更新');
  assert.equal(QuoteFormat.formatRelativeTime(now - 59 * 1000, now), '59 秒前更新');
});

test('formatRelativeTime shows N 分钟前更新 under 1 hour', () => {
  const now = Date.UTC(2026, 6, 31, 6, 32, 0);
  assert.equal(QuoteFormat.formatRelativeTime(now - 60 * 1000, now), '1 分钟前更新');
  assert.equal(QuoteFormat.formatRelativeTime(now - 59 * 60 * 1000, now), '59 分钟前更新');
});

test('formatRelativeTime falls back to formatUpdateTime at or beyond 1 hour', () => {
  const now = Date.UTC(2026, 6, 31, 6, 32, 0);
  assert.equal(QuoteFormat.formatRelativeTime(now - 3600 * 1000, now), '13:32 更新');
});

test('getRefreshToastMessage distinguishes outcomes', () => {
  const snap = (results, counts, succeededAt) => ({ results, counts, attemptedAt: 1, succeededAt });
  assert.equal(QuoteFormat.getRefreshToastMessage(snap({}, { fresh: 0, cached: 0, missing: 0 }, null)), '暂无自选股');
  assert.equal(QuoteFormat.getRefreshToastMessage(snap({ x: {} }, { fresh: 0, cached: 0, missing: 1 }, null)), '刷新失败，请稍后重试');
  assert.equal(QuoteFormat.getRefreshToastMessage(snap({ x: {} }, { fresh: 0, cached: 1, missing: 0 }, null)), '实时行情不可用，已保留缓存');
  assert.equal(QuoteFormat.getRefreshToastMessage(snap({ x: {} }, { fresh: 1, cached: 0, missing: 0 }, 2)), '行情已刷新');
});

test('formatBadge rounds and clamps', () => {
  assert.equal(QuoteFormat.formatBadge(2.56), '2.6');
  assert.equal(QuoteFormat.formatBadge(123.4), '123');
  assert.equal(QuoteFormat.formatBadge(1500), '999');
  assert.equal(QuoteFormat.formatBadge(NaN), '--');
});

test('formatBadgeState uses gray for cached', () => {
  assert.deepEqual(
    QuoteFormat.formatBadgeState({
      status: 'cached',
      fetchedAt: 1,
      quote: { changePercent: -2.5, price: 10 }
    }),
    { text: '2.5', color: '#95A5A6' }
  );
});

test('formatBadgeState uses red for positive fresh', () => {
  assert.deepEqual(
    QuoteFormat.formatBadgeState({
      status: 'fresh',
      fetchedAt: 1,
      quote: { changePercent: 3.2, price: 10 }
    }),
    { text: '3.2', color: '#E74C3C' }
  );
});

test('formatTooltipLine includes age for cached', () => {
  const line = QuoteFormat.formatTooltipLine(
    { code: 'sh600519', name: '贵州茅台' },
    {
      status: 'cached',
      fetchedAt: Date.UTC(2026, 6, 31, 6, 32),
      quote: { name: '贵州茅台', changePercent: -2.5, change: -1, price: 10 }
    }
  );
  assert.match(line, /已过期/);
  assert.match(line, /14:32/);
});

test('formatVolume abbreviates large numbers', () => {
  assert.equal(QuoteFormat.formatVolume(0), '0');
  assert.equal(QuoteFormat.formatVolume(12345), '1.2万');
  assert.equal(QuoteFormat.formatVolume(200000000), '2.00亿');
});

test('formatAmount abbreviates large numbers', () => {
  assert.equal(QuoteFormat.formatAmount(0), '0');
  assert.equal(QuoteFormat.formatAmount(50000), '5.0万');
  assert.equal(QuoteFormat.formatAmount(300000000), '3.00亿');
});
