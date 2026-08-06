// src/popup/a11y/focus.ts
// Task 17 Step 3 — 焦点工具函数。
// getFocusableElements：按 DOM 顺序返回容器内所有可聚焦元素（含正向 tabindex）。
// trapFocus：Tab / Shift+Tab 焦点循环（不逃离容器）。
// 无状态、无副作用——纯 DOM 查询 + 事件拦截。

/** CSS 选择器：匹配原生可聚焦元素。 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]'
].join(',');

/**
 * 返回容器内按 DOM 顺序排列的可聚焦元素列表。
 * 过滤掉 disabled 或 hidden（offsetParent 为 null 且不是 fixed）的元素。
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  );
  return elements.filter((el) => {
    // disabled 属性的 button/input 已被选择器排除；此处过滤不可见元素。
    // offsetParent 为 null 意味着元素不可见（display:none / 父级 hidden），
    // 但 fixed 定位元素 offsetParent 也为 null——用 getClientRects 补偿。
    if (el.offsetParent !== null) return true;
    const rects = el.getClientRects();
    return rects.length > 0;
  });
}

/**
 * 焦点陷阱：在容器内循环 Tab / Shift+Tab。
 * 当焦点在第一个元素上按 Shift+Tab 时跳到最后一个；
 * 当焦点在最后一个元素上按 Tab 时跳到第一个。
 * 调用者需在 keydown(Tab) 时调用此函数。
 */
export function trapFocus(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const activeEl = document.activeElement as HTMLElement | null;

  if (event.shiftKey) {
    // Shift+Tab：从第一个跳到最后一个
    if (activeEl === first || activeEl === null || !container.contains(activeEl)) {
      event.preventDefault();
      last.focus();
    }
  } else {
    // Tab：从最后一个跳到第一个
    if (activeEl === last || activeEl === null || !container.contains(activeEl)) {
      event.preventDefault();
      first.focus();
    }
  }
}
