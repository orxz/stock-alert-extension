// src/popup/components/detail-tooltip.ts
// 悬停详情浮层翻转：行/卡片位于滚动容器可视区底部附近时，浮层默认向下展开
// （top: calc(100% + 4px)）会被滚动容器裁剪——最后几行完全读不到详情。
// 这里按 getBoundingClientRect 判定并切换 is-flipped class，CSS 负责向上展开。
// 纯 DOM 辅助，无组件状态；由 stock-table / stock-card 在 hover/focus 时调用。
//
// 判定基准：浮层下缘超出滚动容器可视区下缘（4px 容差）→ 翻转。
// 注意：必须在浮层可见时调用（display:none 时 rect 全为 0，判定无意义）。

/** 可视区底部容差（px）：浮层下缘距容器下缘小于该值即翻转。 */
const VIEWPORT_TOLERANCE = 4;

/** 判定浮层是否应翻转向上一侧（浮层须可见，display:none 时 rect 全 0 无意义）。 */
export function tooltipNeedsFlip(tooltip: HTMLElement, viewport: Element): boolean {
  return tooltip.getBoundingClientRect().bottom > viewport.getBoundingClientRect().bottom - VIEWPORT_TOLERANCE;
}

/**
 * 按可视区底部刷新浮层方向。
 * @param host 行/卡片元素（内含 .stock-detail-tooltip）。
 * @param viewport 滚动容器（stock-board），其可视区决定裁剪边界。
 */
export function applyTooltipFlip(host: HTMLElement, viewport: Element): void {
  const tooltip = host.querySelector('.stock-detail-tooltip') as HTMLElement | null;
  if (!tooltip) return;
  tooltip.classList.toggle('is-flipped', tooltipNeedsFlip(tooltip, viewport));
}
