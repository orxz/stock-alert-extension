// 悬停详情使用 fixed 定位，按 Popup 可见边界约束，避免被 stock-board 的滚动裁切。
// 方向始终基于触发行/卡片与浮层尺寸；不使用浮层当前 top/bottom，重复定位不会反复翻转。
// CSS 负责 fixed/宽度/overflow，组件在 hover、focus、滚动及异步图表绘制后调用。

const VIEWPORT_PADDING = 8;
const HOST_GAP = 4;

interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** 优先限制在 stock-app 内，同时不超出文档可见视口；滚动容器只用于寻找 Popup。 */
function visibleBounds(host: Element, viewport: Element): Bounds {
  const document = host.ownerDocument;
  const root = document.documentElement;
  const window = document.defaultView;
  const screen: Bounds = {
    left: 0,
    top: 0,
    right: root.clientWidth || window?.innerWidth || 0,
    bottom: root.clientHeight || window?.innerHeight || 0
  };
  const app = host.closest('stock-app') ?? viewport.closest('stock-app');
  const rect = app?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return screen;
  const bounds = {
    left: Math.max(screen.left, rect.left),
    top: Math.max(screen.top, rect.top),
    right: Math.min(screen.right, rect.right),
    bottom: Math.min(screen.bottom, rect.bottom)
  };
  return bounds.right > bounds.left && bounds.bottom > bounds.top ? bounds : screen;
}

function paddedBounds(bounds: Bounds): Bounds {
  const horizontal = Math.min(VIEWPORT_PADDING, (bounds.right - bounds.left) / 2);
  const vertical = Math.min(VIEWPORT_PADDING, (bounds.bottom - bounds.top) / 2);
  return {
    left: bounds.left + horizontal,
    top: bounds.top + vertical,
    right: bounds.right - horizontal,
    bottom: bounds.bottom - vertical
  };
}

function placement(host: Element, tooltip: HTMLElement, bounds: Bounds): {
  left: number; top: number; flipped: boolean;
} {
  const anchor = host.getBoundingClientRect();
  const size = tooltip.getBoundingClientRect();
  const width = Math.min(size.width, bounds.right - bounds.left);
  const height = Math.min(size.height, bounds.bottom - bounds.top);
  const below = bounds.bottom - anchor.bottom - HOST_GAP;
  const above = anchor.top - HOST_GAP - bounds.top;
  // 下方优先；两侧都不够时选择空间更大的一侧，再把整块浮层约束在 Popup 内。
  const flipped = height > below && (height <= above || above > below);
  const preferredTop = flipped ? anchor.top - HOST_GAP - height : anchor.bottom + HOST_GAP;
  return {
    left: Math.min(Math.max(anchor.left, bounds.left), bounds.right - width),
    top: Math.min(Math.max(preferredTop, bounds.top), bounds.bottom - height),
    flipped
  };
}

/** 兼容原方向查询 API；依据触发元素几何，已翻转浮层的 rect 不影响判定。 */
export function tooltipNeedsFlip(tooltip: HTMLElement, viewport: Element): boolean {
  const host = tooltip.closest('stock-card, .stock-table-row') ?? tooltip.parentElement;
  if (!host) return false;
  return placement(host, tooltip, paddedBounds(visibleBounds(host, viewport))).flipped;
}

/** 浮层须可见；尺寸变化后重复调用即可重定位，不使用上次翻转状态作基准。 */
export function applyTooltipFlip(host: HTMLElement, viewport: Element): void {
  const tooltip = host.querySelector<HTMLElement>('.stock-detail-tooltip');
  if (!tooltip) return;
  const bounds = paddedBounds(visibleBounds(host, viewport));
  // 先约束尺寸再测量，让窄视口的换行和最大高度计入定位。
  tooltip.style.maxWidth = `${bounds.right - bounds.left}px`;
  tooltip.style.maxHeight = `${bounds.bottom - bounds.top}px`;
  const size = tooltip.getBoundingClientRect();
  if (size.width <= 0 || size.height <= 0) return;
  const position = placement(host, tooltip, bounds);
  tooltip.style.left = `${position.left}px`;
  tooltip.style.top = `${position.top}px`;
  tooltip.classList.toggle('is-flipped', position.flipped);
}

/** 关闭或离开时清理 fixed 坐标，避免复用行/卡片时带上旧定位。 */
export function clearTooltipPosition(host: HTMLElement): void {
  const tooltip = host.querySelector<HTMLElement>('.stock-detail-tooltip');
  if (!tooltip) return;
  tooltip.classList.remove('is-flipped');
  for (const property of ['left', 'top', 'max-width', 'max-height']) {
    tooltip.style.removeProperty(property);
  }
}
