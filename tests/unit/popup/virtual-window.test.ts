import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateVirtualWindow } from '../../../src/popup/virtualization/virtual-window.js';

test('empty input produces an empty safe window', () => {
  assert.deepEqual(calculateVirtualWindow({
    itemCount: 0, itemExtent: 48, viewportExtent: 390,
    scrollOffset: 0, overscanScreens: 1
  }), {
    startIndex: 0, endIndex: 0, beforeExtent: 0,
    afterExtent: 0, normalizedScrollOffset: 0
  });
});

test('500 rows render only the viewport plus one screen of overscan on each side', () => {
  const result = calculateVirtualWindow({
    itemCount: 500, itemExtent: 48, viewportExtent: 390,
    scrollOffset: 4_800, overscanScreens: 1
  });
  assert.ok(result.endIndex - result.startIndex <= 27);
  assert.equal(result.beforeExtent, result.startIndex * 48);
  assert.equal(result.afterExtent, (500 - result.endIndex) * 48);
});

test('scroll offset is clamped after data shrinks', () => {
  const result = calculateVirtualWindow({
    itemCount: 3, itemExtent: 48, viewportExtent: 390,
    scrollOffset: 9_999, overscanScreens: 1
  });
  assert.equal(result.normalizedScrollOffset, 0);
  assert.equal(result.endIndex, 3);
});

test('invalid inputs produce a finite safe window', () => {
  assert.deepEqual(calculateVirtualWindow({
    itemCount: Number.NaN, itemExtent: 0, viewportExtent: Number.NEGATIVE_INFINITY,
    scrollOffset: Number.NaN, overscanScreens: Number.NEGATIVE_INFINITY
  }), {
    startIndex: 0, endIndex: 0, beforeExtent: 0,
    afterExtent: 0, normalizedScrollOffset: 0
  });
});
