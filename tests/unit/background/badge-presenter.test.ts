// tests/unit/background/badge-presenter.test.ts
// Task 11 — projectActionState 纯函数测试：
// 空 watchlist / 有行情 badge 涨跌色 / tooltip 前 5 只 / 无行情 title。
import assert from 'node:assert/strict';
import test from 'node:test';

import { projectActionState } from '../../../src/background/badge-presenter.js';
import type { Stock } from '../../../src/domain/stock.js';
import type { StockCode } from '../../../src/domain/brands.js';
import type { Quote, QuoteResult, QuoteSnapshot } from '../../../src/domain/quote.js';

const NOW = 1710468000000; // 2024-03-15 10:00 Shanghai (盘中)

function sc(value: string): StockCode {
  return value as StockCode;
}

function makeStock(code: string, name: string): Stock {
  return {
    code: sc(code),
    name,
    groupIds: [],
    manualOrder: {},
    pinned: {},
    addedAt: 1000
  };
}

function makeQuote(code: string, name: string, changePercent: number, change = 1, price = 100): Quote {
  return {
    code: sc(code),
    name,
    price,
    change,
    changePercent,
    amount: 1_000_000
  };
}

function makeFreshResult(code: string, quote: Quote): QuoteResult {
  return {
    code: sc(code),
    status: 'fresh',
    source: 'eastmoney',
    provider: 'eastmoney',
    fetchedAt: NOW,
    quote,
    error: null
  };
}

function makeMissingResult(code: string): QuoteResult {
  return {
    code: sc(code),
    status: 'missing',
    source: 'none',
    provider: null,
    fetchedAt: null,
    quote: null,
    error: 'unavailable'
  };
}

function makeSnapshot(results: Record<string, QuoteResult>): QuoteSnapshot {
  const counts = { fresh: 0, cached: 0, missing: 0 };
  for (const r of Object.values(results)) counts[r.status] += 1;
  return {
    results,
    counts,
    attemptedAt: NOW,
    succeededAt: counts.fresh > 0 ? NOW : null,
    generation: 1
  };
}

// ===== 空 watchlist =====

test('projectActionState: empty stocks returns empty badge and add-prompt title', () => {
  const snapshot = makeSnapshot({});
  const state = projectActionState([], snapshot, NOW);
  assert.equal(state.text, '');
  assert.equal(state.color, '');
  assert.equal(state.title, '股票提醒助手\n暂无自选股，点击添加');
});

// ===== 有行情：涨跌色 =====

test('projectActionState: fresh positive changePercent → red badge', () => {
  const stock = makeStock('sh600519', '贵州茅台');
  const quote = makeQuote('sh600519', '贵州茅台', 2.5, 45, 1800);
  const snapshot = makeSnapshot({ sh600519: makeFreshResult('sh600519', quote) });
  const state = projectActionState([stock], snapshot, NOW);
  assert.equal(state.text, '2.5');
  assert.equal(state.color, '#E74C3C');
  assert.ok(state.title.includes('贵州茅台'));
  assert.ok(state.title.includes('▲'));
  assert.ok(state.title.includes('2.5%'));
});

test('projectActionState: fresh negative changePercent → green badge', () => {
  const stock = makeStock('sz000001', '平安银行');
  const quote = makeQuote('sz000001', '平安银行', -1.2, -0.2, 10);
  const snapshot = makeSnapshot({ sz000001: makeFreshResult('sz000001', quote) });
  const state = projectActionState([stock], snapshot, NOW);
  assert.equal(state.text, '1.2');
  assert.equal(state.color, '#27AE60');
  assert.ok(state.title.includes('▼'));
  assert.ok(state.title.includes('-1.2%'));
});

test('projectActionState: badge from first sorted stock (stocks[0])', () => {
  const stock1 = makeStock('sh600519', '贵州茅台');
  const stock2 = makeStock('sz000001', '平安银行');
  const quote1 = makeQuote('sh600519', '贵州茅台', 3.0, 50, 1800);
  const quote2 = makeQuote('sz000001', '平安银行', -1.0, -0.1, 10);
  const snapshot = makeSnapshot({
    sh600519: makeFreshResult('sh600519', quote1),
    sz000001: makeFreshResult('sz000001', quote2)
  });
  // stock1 is first → badge from stock1
  const state = projectActionState([stock1, stock2], snapshot, NOW);
  assert.equal(state.text, '3.0');
  assert.equal(state.color, '#E74C3C');
});

// ===== tooltip 前 5 只 =====

test('projectActionState: tooltip shows at most 5 stocks', () => {
  const stocks: Stock[] = [];
  const results: Record<string, QuoteResult> = {};
  for (let i = 0; i < 8; i++) {
    const code = `sh60000${i}`;
    const stock = makeStock(code, `股票${i}`);
    stocks.push(stock);
    results[code] = makeFreshResult(code, makeQuote(code, `股票${i}`, i * 0.5, i, 100 + i));
  }
  const snapshot = makeSnapshot(results);
  const state = projectActionState(stocks, snapshot, NOW);
  const lines = state.title.split('\n');
  // 第一行是 "股票提醒助手"，后续最多 5 行 tooltip
  assert.equal(lines[0], '股票提醒助手');
  // 5 tooltip lines + 1 prefix = 6 total
  assert.equal(lines.length, 6);
  assert.ok(lines[1].includes('股票0'));
  assert.ok(lines[5].includes('股票4'));
  // 股票5-7 不在 tooltip 中
  assert.ok(!state.title.includes('股票5'));
  assert.ok(!state.title.includes('股票7'));
});

// ===== 无行情 title =====

test('projectActionState: all stocks missing quote → title shows "暂无可用行情"', () => {
  const stock = makeStock('sh600519', '贵州茅台');
  const snapshot = makeSnapshot({ sh600519: makeMissingResult('sh600519') });
  const state = projectActionState([stock], snapshot, NOW);
  // badge: missing → '--' gray
  assert.equal(state.text, '--');
  assert.equal(state.color, '#95A5A6');
  // title: no available quote
  assert.equal(state.title, '股票提醒助手\n暂无可用行情');
});

test('projectActionState: later stock has quote prevents false "no data" title', () => {
  // First stock missing, second stock has quote → hasAnyQuote=true → title shows lines
  const stock1 = makeStock('sh600519', '贵州茅台');
  const stock2 = makeStock('sz000001', '平安银行');
  const snapshot = makeSnapshot({
    sh600519: makeMissingResult('sh600519'),
    sz000001: makeFreshResult('sz000001', makeQuote('sz000001', '平安银行', 0.5, 0.05, 10))
  });
  const state = projectActionState([stock1, stock2], snapshot, NOW);
  // hasAnyQuote=true → not "暂无可用行情"
  assert.notEqual(state.title, '股票提醒助手\n暂无可用行情');
  assert.ok(state.title.includes('平安银行'));
  // badge from stock1 (missing) → '--'
  assert.equal(state.text, '--');
  assert.equal(state.color, '#95A5A6');
});

// ===== cached 行情追加年龄 =====

test('projectActionState: cached result includes age time in tooltip', () => {
  const stock = makeStock('sh600519', '贵州茅台');
  const cachedResult: QuoteResult = {
    code: sc('sh600519'),
    status: 'cached',
    source: 'cache',
    provider: 'eastmoney',
    fetchedAt: NOW - 120_000, // 2 分钟前
    quote: makeQuote('sh600519', '贵州茅台', 1.5, 27, 1800),
    error: null
  };
  const snapshot = makeSnapshot({ sh600519: cachedResult });
  const state = projectActionState([stock], snapshot, NOW);
  // cached badge → gray
  assert.equal(state.color, '#95A5A6');
  // tooltip includes "已过期" + time
  assert.ok(state.title.includes('已过期'));
});
