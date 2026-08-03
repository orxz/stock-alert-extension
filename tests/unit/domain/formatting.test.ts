// tests/unit/domain/formatting.test.ts
// Task 4 Step 5 — 格式化纯函数测试 + v1.3 golden parity。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  formatBadge,
  formatBadgeState,
  formatTooltipLine,
  formatTime,
  formatVolume,
  formatAmount,
  chinaTimeParts,
  isChinaMarketActive,
  getRefreshIntervalMs
} from '../../../src/domain/formatting.js';

// ── golden fixture（v1.3 冻结契约）──
const fixtureUrl = new URL('../../fixtures/v1.3/formatting.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8'));
const NOW = fixture.capturedAt; // Date.parse('2026-08-03T01:30:00.000Z') = 1785720600000
const quote = { code: 'sh600519', price: 1500, change: 12, changePercent: 0.81, amount: 2_000_000_000 };

test('golden: formatBadge(changePercent) === fixture.payload.badge', () => {
  assert.equal(formatBadge(quote.changePercent), fixture.payload.badge);
  assert.equal(fixture.payload.badge, '0.8');
});

test('golden: formatBadgeState(fresh) === fixture.payload.freshState', () => {
  const result = { code: 'sh600519', status: 'fresh', source: 'eastmoney', provider: 'eastmoney', fetchedAt: NOW, quote, error: null };
  assert.deepEqual(formatBadgeState(result), fixture.payload.freshState);
  assert.deepEqual(fixture.payload.freshState, { text: '0.8', color: '#E74C3C' });
});

test('golden: formatTooltipLine(cached) === fixture.payload.cachedLine', () => {
  // capture 脚本用 fetchedAt = now - 60_000 → CST 09:29
  const stock = { code: 'sh600519', name: '贵州茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 };
  const result = { code: 'sh600519', status: 'cached', source: 'cache', provider: 'eastmoney', fetchedAt: NOW - 60_000, quote, error: null };
  assert.equal(formatTooltipLine(stock, result), fixture.payload.cachedLine);
  assert.equal(fixture.payload.cachedLine, '贵州茅台 ▲ 0.8% · 已过期 09:29');
});

// ── formatBadge 分级 ──
test('formatBadge boundary cases', () => {
  assert.equal(formatBadge(NaN), '--');
  assert.equal(formatBadge(Infinity), '--');
  assert.equal(formatBadge(999.9), '1000'); // >=100 → Math.round(999.9)=1000
  assert.equal(formatBadge(1000), '999'); // |x|>=1000 → '999'
  assert.equal(formatBadge(-1000), '999');
  assert.equal(formatBadge(123.4), '123'); // >=100 → Math.round
  assert.equal(formatBadge(99.6), '100'); // >=100 → Math.round → 100
  assert.equal(formatBadge(15.6), '16'); // >=10 → toFixed(0)
  assert.equal(formatBadge(9.99), '10.0'); // <10 → toFixed(1) → "10.0"
  assert.equal(formatBadge(0.8), '0.8');
  assert.equal(formatBadge(-5.5), '5.5'); // abs
});

// ── formatBadgeState ──
test('formatBadgeState colors', () => {
  const mk = (status, changePercent) => ({ code: 'c', status, source: 'eastmoney', provider: 'eastmoney', fetchedAt: 0, quote: { code: 'c', price: 1, change: changePercent > 0 ? 1 : -1, changePercent, amount: 0 }, error: null });
  assert.deepEqual(formatBadgeState(mk('fresh', 1.5)), { text: '1.5', color: '#E74C3C' }); // 正 → 红
  assert.deepEqual(formatBadgeState(mk('fresh', -1.5)), { text: '1.5', color: '#27AE60' }); // 负 → 绿
  assert.deepEqual(formatBadgeState(mk('fresh', 0)), { text: '0.0', color: '#95A5A6' }); // 零 → 灰
  assert.deepEqual(formatBadgeState(mk('cached', 5)), { text: '5.0', color: '#95A5A6' }); // cached → 灰（formatBadge(5)=5.0）
  assert.deepEqual(formatBadgeState({ code: 'c', status: 'missing', source: 'none', provider: null, fetchedAt: null, quote: null, error: 'x' }), { text: '--', color: '#95A5A6' });
});

// ── formatTooltipLine ──
test('formatTooltipLine no-quote fallback', () => {
  const stock = { code: 'sh600519', name: '贵州茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 };
  const missing = { code: 'sh600519', status: 'missing', source: 'none', provider: null, fetchedAt: null, quote: null, error: 'x' };
  assert.equal(formatTooltipLine(stock, missing), '贵州茅台  暂无行情');
});

test('formatTooltipLine fresh omits expiry suffix', () => {
  const stock = { code: 'sh600519', name: '贵州茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 };
  const result = { code: 'sh600519', status: 'fresh', source: 'eastmoney', provider: 'eastmoney', fetchedAt: NOW, quote, error: null };
  assert.equal(formatTooltipLine(stock, result), '贵州茅台 ▲ 0.8%');
});

test('formatTooltipLine arrow reflects change sign', () => {
  const stock = { code: 'c', name: 'X', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 };
  const down = { code: 'c', status: 'fresh', source: 'eastmoney', provider: 'eastmoney', fetchedAt: 0, quote: { code: 'c', price: 10, change: -5, changePercent: -2.5, amount: 0 }, error: null };
  assert.ok(formatTooltipLine(stock, down).includes('▼'));
  const flat = { code: 'c', status: 'fresh', source: 'eastmoney', provider: 'eastmoney', fetchedAt: 0, quote: { code: 'c', price: 10, change: 0, changePercent: 0, amount: 0 }, error: null };
  assert.ok(formatTooltipLine(stock, flat).includes('—'));
});

// ── formatTime ──
test('formatTime formats in Asia/Shanghai h23', () => {
  // NOW = 2026-08-03T01:30:00Z → CST 09:30
  assert.equal(formatTime(NOW), '09:30');
  // NOW - 60_000 → CST 09:29
  assert.equal(formatTime(NOW - 60_000), '09:29');
});

// ── formatVolume / formatAmount ──
test('formatVolume 亿/万 分级', () => {
  assert.equal(formatVolume(0), '0');
  assert.equal(formatVolume(500), '500');
  assert.equal(formatVolume(15000), '1.5万');
  assert.equal(formatVolume(200000000), '2.00亿');
});

test('formatAmount 亿/万 分级', () => {
  assert.equal(formatAmount(0), '0');
  assert.equal(formatAmount(500), '500');
  assert.equal(formatAmount(15000), '1.5万');
  assert.equal(formatAmount(200000000), '2.00亿');
});

// ── chinaTimeParts / isChinaMarketActive ──
test('chinaTimeParts returns Shanghai weekday/hour/minute', () => {
  const parts = chinaTimeParts(NOW); // CST Monday 09:30
  assert.equal(parts.weekday, 'Mon');
  assert.equal(parts.hour, '09');
  assert.equal(parts.minute, '30');
});

test('isChinaMarketActive is true during trading windows and false on weekends', () => {
  // 2026-08-03 is Monday. CST 09:30 → within 9:15-11:35
  assert.equal(isChinaMarketActive(NOW), true);
  // CST 11:00 → 03:00 UTC → 1785720600000 + 1.5h = +5400000
  assert.equal(isChinaMarketActive(NOW + 5_400_000), true); // 11:00 CST
  // CST 13:00 → 05:00 UTC → +12600000
  assert.equal(isChinaMarketActive(NOW + 12_600_000), true); // 13:00 within 12:55-15:05
  // CST 12:00 → 04:00 UTC → +9000000 → outside both windows
  assert.equal(isChinaMarketActive(NOW + 9_000_000), false); // 12:00 lunch gap
  // Saturday: 2026-08-01T01:30:00Z → 2 days before NOW
  const saturday = NOW - 2 * 86_400_000;
  assert.equal(isChinaMarketActive(saturday), false);
});

// ── getRefreshIntervalMs ──
test('getRefreshIntervalMs returns market/timeout intervals', () => {
  // Trading hours (Monday 09:30 CST)
  assert.equal(getRefreshIntervalMs(NOW, 'background'), 30_000);
  assert.equal(getRefreshIntervalMs(NOW, 'popup'), 10_000);
  // Off hours (Monday 12:00 CST — lunch gap)
  assert.equal(getRefreshIntervalMs(NOW + 9_000_000, 'background'), 300_000);
  assert.equal(getRefreshIntervalMs(NOW + 9_000_000, 'popup'), 300_000);
});
