// tests/unit/popup/virtual-window.test.ts
// 计划 Task 1 — 纯虚拟窗口计算器：范围 / spacer / 归一化滚动位置。
import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateVirtualWindow } from '../../../src/popup/virtualization/virtual-window.js';

test('empty input produces an empty safe window', () => {
  assert.deepEqual(
    calculateVirtualWindow({
      itemCount: 0,
      itemExtent: 48,
      viewportExtent: 390,
      scrollOffset: 0,
      overscanScreens: 1
    }),
    { startIndex: 0, endIndex: 0, beforeExtent: 0, afterExtent: 0, normalizedScrollOffset: 0 }
  );
});

test('500 rows render only the viewport plus one screen of overscan on each side', () => {
  const result = calculateVirtualWindow({
    itemCount: 500,
    itemExtent: 48,
    viewportExtent: 390,
    scrollOffset: 4_800,
    overscanScreens: 1
  });
  assert.ok(result.endIndex - result.startIndex <= 27, `window ${result.endIndex - result.startIndex}`);
  assert.equal(result.beforeExtent, result.startIndex * 48);
  assert.equal(result.afterExtent, (500 - result.endIndex) * 48);
});

test('scroll offset is clamped after data shrinks', () => {
  const result = calculateVirtualWindow({
    itemCount: 3,
    itemExtent: 48,
    viewportExtent: 390,
    scrollOffset: 9_999,
    overscanScreens: 1
  });
  assert.equal(result.normalizedScrollOffset, 0);
  assert.equal(result.endIndex, 3);
});

test('spacer extents always reconstruct the full scroll height', () => {
  // 不变量：beforeExtent + 渲染行高度 + afterExtent === itemCount * itemExtent。
  // 否则滚动条长度会跳变。
  for (const scrollOffset of [0, 240, 4_800, 23_000]) {
    const r = calculateVirtualWindow({
      itemCount: 500,
      itemExtent: 48,
      viewportExtent: 390,
      scrollOffset,
      overscanScreens: 1
    });
    const rendered = (r.endIndex - r.startIndex) * 48;
    assert.equal(r.beforeExtent + rendered + r.afterExtent, 500 * 48, `offset ${scrollOffset}`);
  }
});

test('window covers the whole viewport at the very bottom', () => {
  const itemCount = 500;
  const itemExtent = 48;
  const viewportExtent = 390;
  const maxOffset = itemCount * itemExtent - viewportExtent;
  const r = calculateVirtualWindow({
    itemCount, itemExtent, viewportExtent, scrollOffset: maxOffset, overscanScreens: 1
  });
  assert.equal(r.endIndex, itemCount, 'last row is rendered');
  assert.ok(r.startIndex * itemExtent <= maxOffset, 'window starts at or before the viewport top');
});

test('degenerate inputs fall back to safe values instead of NaN', () => {
  const r = calculateVirtualWindow({
    itemCount: Number.NaN,
    itemExtent: 0,
    viewportExtent: -1,
    scrollOffset: Number.NaN,
    overscanScreens: -3
  });
  assert.equal(r.startIndex, 0);
  assert.equal(r.endIndex, 0);
  assert.equal(r.normalizedScrollOffset, 0);
  assert.ok(Number.isFinite(r.beforeExtent) && Number.isFinite(r.afterExtent));
});
