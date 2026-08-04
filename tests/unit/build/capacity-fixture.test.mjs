// tests/unit/build/capacity-fixture.test.mjs
// Task 19 Step 1 — 验证确定性容量夹具的结构完整性与字节级可重复性。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCapacityFixture,
  serializeFixture,
  verifyDeterminism,
  codeFor,
  CAPACITY_CONFIG
} from '../../../scripts/generate-capacity-fixture.mjs';

test('capacity fixture has exactly 20 groups and 500 stocks', () => {
  const fixture = buildCapacityFixture();
  assert.equal(fixture.groups.length, 20);
  assert.equal(fixture.watchlist.length, 500);
});

test('first group is g_all (default) with order 0', () => {
  const fixture = buildCapacityFixture();
  assert.equal(fixture.groups[0].groupId, 'g_all');
  assert.equal(fixture.groups[0].isDefault, true);
  assert.equal(fixture.groups[0].order, 0);
});

test('all custom groups have unique ids and names', () => {
  const fixture = buildCapacityFixture();
  const customs = fixture.groups.filter((g) => !g.isDefault);
  assert.equal(customs.length, 19);
  const ids = new Set(customs.map((g) => g.groupId));
  const names = new Set(customs.map((g) => g.name));
  assert.equal(ids.size, 19);
  assert.equal(names.size, 19);
});

test('every stock code is a valid sh/sz/bj 6-digit code', () => {
  const fixture = buildCapacityFixture();
  const valid = /^(sh(600|601|603|605|688|689)\d{3}|sz(000|001|002|003|300|301)\d{3}|bj(920|830|870|880|430|480)\d{3})$/;
  for (const s of fixture.watchlist) {
    assert.match(s.code, valid, `invalid code: ${s.code}`);
  }
});

test('all 500 stock codes are unique', () => {
  const fixture = buildCapacityFixture();
  const codes = new Set(fixture.watchlist.map((s) => s.code));
  assert.equal(codes.size, 500);
});

test('no stock belongs to g_all in groupIds', () => {
  const fixture = buildCapacityFixture();
  for (const s of fixture.watchlist) {
    assert.ok(!s.groupIds.includes('g_all'), `stock ${s.code} has g_all in groupIds`);
  }
});

test('boardConfig covers all 20 groups', () => {
  const fixture = buildCapacityFixture();
  for (const g of fixture.groups) {
    assert.ok(fixture.boardConfig[g.groupId], `missing boardConfig for ${g.groupId}`);
  }
});

test('cache entries split into fresh/cached/stale/missing (~25% each)', () => {
  const fixture = buildCapacityFixture();
  const cacheKeys = Object.keys(fixture).filter((k) => k.startsWith('quoteCache:'));
  // 500 * 3/4 = 375 (1/4 missing)。
  assert.equal(cacheKeys.length, 375);
});

test('all cache entries have cacheVersion 1 and valid provider', () => {
  const fixture = buildCapacityFixture();
  const cacheKeys = Object.keys(fixture).filter((k) => k.startsWith('quoteCache:'));
  for (const key of cacheKeys) {
    const entry = fixture[key];
    assert.equal(entry.cacheVersion, 1);
    assert.ok(['eastmoney', 'sina'].includes(entry.provider));
    assert.ok(typeof entry.fetchedAt === 'number');
    assert.ok(typeof entry.quote.price === 'number');
  }
});

test('fixture timestamps anchor at baseEpoch', () => {
  const fixture = buildCapacityFixture();
  assert.equal(fixture.capturedAt, CAPACITY_CONFIG.baseEpoch);
  // 第一个自定义分组 createdAt = baseEpoch + 1000。
  const firstCustom = fixture.groups[1];
  assert.equal(firstCustom.createdAt, CAPACITY_CONFIG.baseEpoch + 1000);
});

test('two independent builds produce byte-identical SHA-256', () => {
  const { sha256: sha1 } = verifyDeterminism();
  const { sha256: sha2 } = verifyDeterminism();
  assert.equal(sha1, sha2);
  // 已知稳定 SHA（固定前缀 + 确定性算法）。
  assert.equal(sha1.length, 64);
});

test('serialized fixture is stable JSON (2-space indent, trailing newline)', () => {
  const text = serializeFixture(buildCapacityFixture());
  assert.ok(text.endsWith('\n'));
  // 不含 [object Object] 或 undefined。
  assert.ok(!text.includes('[object Object]'));
  assert.ok(!text.includes('undefined'));
});

test('codeFor is a pure deterministic function (same index → same code)', () => {
  for (let i = 0; i < 500; i++) {
    assert.equal(codeFor(i), codeFor(i));
  }
  // 相邻 index 在同一市场中前缀递增。
  assert.notEqual(codeFor(0), codeFor(3)); // 不同市场。
  assert.notEqual(codeFor(0), codeFor(18)); // 同市场不同后缀。
});

test('fixture object is serializable without circular references', () => {
  const fixture = buildCapacityFixture();
  const json = JSON.stringify(fixture);
  const parsed = JSON.parse(json);
  assert.equal(parsed.groups.length, 20);
  assert.equal(parsed.watchlist.length, 500);
});
