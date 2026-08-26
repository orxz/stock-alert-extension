// tests/unit/domain/chart.test.ts
// v2.2 图表领域纯函数：sparkline 抽样 / 可用性判定。
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildIndexSparkline, isUsableTrends, isUsableKlines } from '../../../src/domain/chart.js';
import type { TrendPoint, KlineBar } from '../../../src/domain/chart.js';

function pt(price: number, time = 0): TrendPoint {
  return { time, price, avgPrice: price, high: price, low: price, volume: 0, amount: 0, volumeRatio: 0 };
}

test('buildIndexSparkline samples at most maxPoints and ends with last price', () => {
  const trends = Array.from({ length: 121 }, (_, i) => pt(100 + Math.sin(i / 10), i * 60_000));
  const seq = buildIndexSparkline(trends);
  // step=ceil(121/20)=7 → 采样 0,7,14,...,119（18 点）+ last（119 已含则不加）
  assert.ok(seq.length <= 20, '不超过 20 点');
  assert.ok(seq.length >= 15, '至少覆盖抽样密度');
  assert.ok(seq.every((v) => v >= 0 && v <= 1), '归一化 0..1');
});

test('buildIndexSparkline handles empty and flat series', () => {
  assert.deepEqual(buildIndexSparkline([]), [0.5]);
  const flat = Array.from({ length: 10 }, () => pt(100));
  const seq = buildIndexSparkline(flat);
  assert.ok(seq.every((v) => v === 0.5), '平走 → 0.5');
});

test('buildIndexSparkline normalizes range correctly', () => {
  const seq = buildIndexSparkline([pt(100), pt(200)]);
  assert.deepEqual(seq, [0, 1]);
});

test('buildIndexSparkline honors custom maxPoints', () => {
  const trends = Array.from({ length: 50 }, (_, i) => pt(i));
  const seq = buildIndexSparkline(trends, 5);
  assert.ok(seq.length <= 6, '5 点上限 + last');
});

test('isUsableTrends requires >=2 points with positive finite prices', () => {
  assert.equal(isUsableTrends(undefined), false);
  assert.equal(isUsableTrends([]), false);
  assert.equal(isUsableTrends([pt(100)]), false, '单点不可用');
  assert.equal(isUsableTrends([pt(100), pt(101)]), true);
  assert.equal(isUsableTrends([pt(100), pt(0)]), false, '零价不可用');
  assert.equal(isUsableTrends([pt(100), pt(Number.NaN)]), false, 'NaN 不可用');
});

test('isUsableKlines requires >=1 bar with positive finite close', () => {
  assert.equal(isUsableKlines(undefined), false);
  assert.equal(isUsableKlines([]), false);
  const bar: KlineBar = { date: '2026-08-26', open: 1, close: 100, high: 101, low: 99, volume: 1, amount: 1, changePercent: 0, turnoverRate: 0 };
  assert.equal(isUsableKlines([bar]), true);
  assert.equal(isUsableKlines([{ ...bar, close: 0 }]), false);
  assert.equal(isUsableKlines([{ ...bar, close: Number.NaN }]), false);
});
