// tests/unit/protocol/validators.test.ts
// 直接覆盖 validators.ts 各组合子的成功与失败分支，补齐 critical-coverage per-file 门禁。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  string,
  boolean,
  nonEmptyTrimmedString,
  literalEnum,
  array,
  duplicateFreeArray,
  maxItems,
  strictObject,
  partialStrictObject,
  stockCode,
  groupId,
  revision,
  groupName
} from '../../../src/protocol/validators.js';

// ===== 基础标量 =====

test('string() accepts strings, rejects non-strings', () => {
  const v = string();
  assert.equal(v('hello').ok, true);
  assert.equal(v(123).ok, false);
  assert.equal(v(null).ok, false);
  assert.equal(v(undefined).ok, false);
});

test('boolean() accepts booleans, rejects non-booleans', () => {
  const v = boolean();
  assert.equal(v(true).ok, true);
  assert.equal(v(false).ok, true);
  assert.equal(v('true').ok, false);
  assert.equal(v(1).ok, false);
});

test('nonEmptyTrimmedString() rejects empty-after-trim and non-string', () => {
  const v = nonEmptyTrimmedString();
  assert.equal(v('  hi  ').ok, true);
  assert.equal(v('   ').ok, false);
  assert.equal(v('').ok, false);
  assert.equal(v(42).ok, false);
});

test('literalEnum() accepts only listed values', () => {
  const v = literalEnum('a', 'b');
  assert.equal(v('a').ok, true);
  assert.equal(v('b').ok, true);
  assert.equal(v('c').ok, false);
  assert.equal(v(1).ok, false);
});

// ===== 数组组合子 =====

test('array() rejects non-array and propagates element failures', () => {
  const numStr = array(string());
  assert.equal(numStr(['a', 'b']).ok, true);
  assert.equal(numStr('not-array').ok, false);
  assert.equal(numStr(['ok', 123]).ok, false);
});

test('duplicateFreeArray() rejects duplicates', () => {
  const dedup = duplicateFreeArray(string());
  assert.equal(dedup(['a', 'b']).ok, true);
  assert.equal(dedup(['a', 'a']).ok, false);
  assert.equal(dedup('x').ok, false); // non-array
});

test('maxItems() enforces length cap then delegates', () => {
  const capped = maxItems(2, array(string()));
  assert.equal(capped(['a', 'b']).ok, true);
  assert.equal(capped(['a', 'b', 'c']).ok, false);
  assert.equal(capped('x').ok, false); // delegated non-array → array rejects
});

// ===== 严格对象 =====

test('strictObject() rejects non-objects, forbidden keys, unknown keys', () => {
  const obj = strictObject({ name: string(), age: boolean() });
  assert.equal(obj({ name: 'x', age: true }).ok, true);
  assert.equal(obj(null).ok, false);
  assert.equal(obj('str').ok, false);
  assert.equal(obj([]).ok, false);
  // __proto__ 必须用 Object.defineProperty 设置（字面量 { __proto__: 1 } 设置原型而非键）
  const evil: Record<string, unknown> = {};
  Object.defineProperty(evil, '__proto__', { value: 1, enumerable: true });
  evil.name = 'x';
  assert.equal(obj(evil).ok, false);
  assert.equal(obj({ name: 'x', extra: 1 }).ok, false);
  assert.equal(obj({ name: 'x', age: 'not-bool' }).ok, false);
});

test('partialStrictObject() allows subset, rejects non-object/forbidden/unknown', () => {
  const partial = partialStrictObject({ a: string(), b: boolean() });
  assert.equal(partial({}).ok, true);
  assert.equal(partial({ a: 'x' }).ok, true);
  assert.equal(partial({ b: true }).ok, true);
  assert.equal(partial(null).ok, false);
  assert.equal(partial('str').ok, false);
  assert.equal(partial([]).ok, false);
  // constructor 键需用 defineProperty（字面量不触发）
  const evil2: Record<string, unknown> = {};
  Object.defineProperty(evil2, 'constructor', { value: 1, enumerable: true });
  assert.equal(partial(evil2).ok, false);
  assert.equal(partial({ unknown: 1 }).ok, false);
  assert.equal(partial({ a: 123 }).ok, false); // field validator fails
});

// ===== ID 与领域标量（工厂函数——先调用获取 validator）=====

test('stockCode() normalizes valid codes, rejects invalid', () => {
  const v = stockCode();
  assert.equal(v('600519').ok, true);
  assert.equal(v('sh600519').ok, true);
  assert.equal(v('invalid!').ok, false);
  assert.equal(v(123).ok, false);
});

test('groupId() accepts g_all and g_<id>, rejects invalid', () => {
  const v = groupId();
  assert.equal(v('g_all').ok, true);
  assert.equal(v('g_abc-123').ok, true);
  assert.equal(v('invalid').ok, false);
  assert.equal(v(42).ok, false);
});

test('revision() accepts sha256:<hex>, rejects invalid', () => {
  const v = revision();
  assert.equal(v('sha256:abcdef0123456789').ok, true);
  assert.equal(v('not-a-revision').ok, false);
  assert.equal(v('sha256:').ok, false); // 空 hex 不匹配
  assert.equal(v(null).ok, false);
});

test('groupName() accepts 1-12 code points, rejects empty/overlong/non-string', () => {
  const v = groupName();
  assert.equal(v('分组').ok, true);
  assert.equal(v('  trimmed  ').ok, true);
  assert.equal(v('   ').ok, false); // empty after trim
  assert.equal(v('a'.repeat(13)).ok, false); // > 12 code points
  assert.equal(v(123).ok, false); // non-string
});
