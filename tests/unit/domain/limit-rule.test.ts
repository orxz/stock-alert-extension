// tests/unit/domain/limit-rule.test.ts
// v2.5.5 涨跌停规则推导：板块幅度 / ST 前缀 / 四舍五入 / 指数排除。
// 数值均为可独立复算的交易所规则（昨收 × 幅度，四舍五入到分）。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isStName,
  limitPctFor,
  computeLimitPrices
} from '../../../src/domain/limit-rule.js';

// ===== isStName =====

test('isStName matches risk-warning prefixes only', () => {
  assert.equal(isStName('ST易购'), true);
  assert.equal(isStName('*ST海投'), true);
  assert.equal(isStName('S*ST前锋'), true);
  assert.equal(isStName('SST华新'), true);
  assert.equal(isStName('st保千里'), true, '大小写不敏感');
  assert.equal(isStName('贵州茅台'), false);
  assert.equal(isStName('TCL科技'), false);
  assert.equal(isStName('GQY视讯'), false);
  assert.equal(isStName(undefined), false);
});

// ===== limitPctFor =====

test('limitPctFor maps board segments to limit percentages', () => {
  assert.equal(limitPctFor('sh600519'), 0.10, '沪主板 ±10%');
  assert.equal(limitPctFor('sz000001'), 0.10, '深主板 ±10%');
  assert.equal(limitPctFor('sz002594'), 0.10, '深主板（原中小板并入）±10%');
  assert.equal(limitPctFor('sz300750'), 0.20, '创业板 ±20%');
  assert.equal(limitPctFor('sz301308'), 0.20, '创业板（301 段）±20%');
  assert.equal(limitPctFor('sh688981'), 0.20, '科创板 ±20%');
  assert.equal(limitPctFor('sh689009'), 0.20, '科创板（689 段）±20%');
  assert.equal(limitPctFor('bj430047'), 0.30, '北交所 ±30%');
  assert.equal(limitPctFor('bj830799'), 0.30, '北交所 ±30%');
  assert.equal(limitPctFor('bj920001'), 0.30, '北交所（920 新段）±30%');
});

test('limitPctFor halves for ST on main board only', () => {
  assert.equal(limitPctFor('sz000001', 'ST平安'), 0.05, '主板 ST ±5%');
  assert.equal(limitPctFor('sz000001', '*ST平安'), 0.05);
  assert.equal(limitPctFor('sz300750', 'ST宁德'), 0.20, '创业板 ST 仍 ±20%');
  assert.equal(limitPctFor('sh688981', 'ST中芯'), 0.20, '科创板 ST 仍 ±20%');
  assert.equal(limitPctFor('bj920001', 'ST北交'), 0.30, '北交所 ST 仍 ±30%');
  assert.equal(limitPctFor('sz000001', '平安银行'), 0.10, '非 ST 主板 ±10%');
});

test('limitPctFor returns null for index codes', () => {
  assert.equal(limitPctFor('sh000001'), null, '上证指数');
  assert.equal(limitPctFor('sz399006'), null, '创业板指');
  assert.equal(limitPctFor('bj899050'), null, '北证50');
});

// ===== computeLimitPrices =====

test('computeLimitPrices derives main-board limits (real-world check)', () => {
  // 茅台 2026-08-26 实测昨收 1304 → 1434.40 / 1173.60。
  assert.deepEqual(computeLimitPrices('sh600519', 1304, '贵州茅台'), {
    limitUp: 1434.4,
    limitDown: 1173.6
  });
});

test('computeLimitPrices covers all board segments', () => {
  assert.deepEqual(computeLimitPrices('sz300750', 100, '宁德时代'), { limitUp: 120, limitDown: 80 });
  assert.deepEqual(computeLimitPrices('sh688981', 50, '中芯国际'), { limitUp: 60, limitDown: 40 });
  assert.deepEqual(computeLimitPrices('bj920001', 10, '北证新股'), { limitUp: 13, limitDown: 7 });
  assert.deepEqual(computeLimitPrices('sz000001', 10, 'ST平安'), { limitUp: 10.5, limitDown: 9.5 });
});

test('computeLimitPrices rounds half-up to cents', () => {
  // 10.05 × 1.10 = 11.055 → 11.06；10.05 × 0.90 = 9.045 → 9.05。
  assert.deepEqual(computeLimitPrices('sh600000', 10.05, '浦发银行'), {
    limitUp: 11.06,
    limitDown: 9.05
  });
});

test('computeLimitPrices rejects invalid prevClose and index codes', () => {
  assert.equal(computeLimitPrices('sh600519', undefined), null);
  assert.equal(computeLimitPrices('sh600519', 0), null);
  assert.equal(computeLimitPrices('sh600519', Number.NaN), null);
  assert.equal(computeLimitPrices('sh600519', -5), null);
  assert.equal(computeLimitPrices('sh000001', 3901.33, '上证指数'), null, '指数不适用');
});
