// src/popup/virtualization/virtual-window.ts
// 纯虚拟窗口计算器：由滚动位置与视口高度推出应渲染的索引区间与上下 spacer 高度。
// 无 DOM、无副作用——list 与 grid 共用同一套算法（grid 按「行」为单位调用）。
//
// 不变量：beforeExtent + (endIndex-startIndex)*itemExtent + afterExtent
//         === itemCount * itemExtent
// 破坏它会让滚动条长度在滚动过程中跳变。

/** 视口状态：滚动偏移与可视高度。 */
export interface VirtualViewport {
  readonly scrollOffset: number;
  readonly viewportExtent: number;
}

/** 计算输入：视口 + 条目总数 + 单条高度 + 过扫描屏数。 */
export interface VirtualWindowInput extends VirtualViewport {
  readonly itemCount: number;
  readonly itemExtent: number;
  readonly overscanScreens: number;
}

/** 计算结果：渲染区间 [startIndex, endIndex) 与上下 spacer 高度。 */
export interface VirtualWindowResult {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly beforeExtent: number;
  readonly afterExtent: number;
  readonly normalizedScrollOffset: number;
}

/** 视口高度兜底值（Popup 看板区固定 390px）。 */
const FALLBACK_VIEWPORT_EXTENT = 390;

/**
 * 计算虚拟窗口。
 *
 * 对非法输入（NaN / 0 / 负数）一律退化到安全值而非抛错——视口尺寸来自
 * `clientHeight` 等 DOM 读数，在元素隐藏或尚未布局时确实会是 0。
 */
export function calculateVirtualWindow(input: VirtualWindowInput): VirtualWindowResult {
  const itemCount = Number.isFinite(input.itemCount) ? Math.max(0, Math.floor(input.itemCount)) : 0;
  const itemExtent =
    Number.isFinite(input.itemExtent) && input.itemExtent > 0 ? input.itemExtent : 1;
  const viewportExtent =
    Number.isFinite(input.viewportExtent) && input.viewportExtent > 0
      ? input.viewportExtent
      : FALLBACK_VIEWPORT_EXTENT;

  const maxOffset = Math.max(0, itemCount * itemExtent - viewportExtent);
  const requestedOffset = Number.isFinite(input.scrollOffset) ? input.scrollOffset : 0;
  const normalizedScrollOffset = Math.min(maxOffset, Math.max(0, requestedOffset));

  if (itemCount === 0) {
    return { startIndex: 0, endIndex: 0, beforeExtent: 0, afterExtent: 0, normalizedScrollOffset: 0 };
  }

  const visibleCount = Math.ceil(viewportExtent / itemExtent);
  const overscanScreens = Number.isFinite(input.overscanScreens)
    ? Math.max(0, input.overscanScreens)
    : 0;
  const overscanCount = Math.ceil(visibleCount * overscanScreens);
  const firstVisible = Math.floor(normalizedScrollOffset / itemExtent);

  const startIndex = Math.max(0, firstVisible - overscanCount);
  const endIndex = Math.min(itemCount, firstVisible + visibleCount + overscanCount);

  return {
    startIndex,
    endIndex,
    beforeExtent: startIndex * itemExtent,
    afterExtent: (itemCount - endIndex) * itemExtent,
    normalizedScrollOffset
  };
}
