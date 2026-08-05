export interface VirtualViewport {
  readonly scrollOffset: number;
  readonly viewportExtent: number;
}

export interface VirtualWindowInput extends VirtualViewport {
  readonly itemCount: number;
  readonly itemExtent: number;
  readonly overscanScreens: number;
}

export interface VirtualWindowResult {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly beforeExtent: number;
  readonly afterExtent: number;
  readonly normalizedScrollOffset: number;
}

export function calculateVirtualWindow(input: VirtualWindowInput): VirtualWindowResult {
  const itemCount = Number.isFinite(input.itemCount) ? Math.max(0, Math.floor(input.itemCount)) : 0;
  const itemExtent = Number.isFinite(input.itemExtent) && input.itemExtent > 0 ? input.itemExtent : 1;
  const viewportExtent = Number.isFinite(input.viewportExtent) && input.viewportExtent > 0
    ? input.viewportExtent
    : 390;
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
