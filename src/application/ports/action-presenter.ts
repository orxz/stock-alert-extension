// src/application/ports/action-presenter.ts
// ActionPresenter 端口接口：Application/Background 层通过此接口投影 Badge 文本/颜色与 Tooltip。
// 纯接口——不依赖 infrastructure/Chrome。
// 具体实现（ChromeActionPresenter）在 infrastructure 层，包装 chrome.action。
//
// 设计要点（brief Step 3 逐字）：
// - render(state): 一次性设置 badge text + background color + action title。
// - clear(title): 清空 badge text（''）并设置 title（用于空 watchlist / 不可用行情）。
//
// 投影策略（badgeStock = sortedStocks[0]、涨跌色映射、tooltip 前 5 只）保留在
// Background badge-presenter 纯函数中，本端口仅提供原子 chrome.action 调用。

/**
 * Action 状态：Badge 文本、Badge 背景色、Tooltip 标题。
 */
export interface ActionState {
  readonly text: string;
  readonly color: string;
  readonly title: string;
}

/**
 * Action 呈现器端口：投影 Badge 与 Tooltip 到 chrome.action。
 * - render(state): 设置 badgeText + badgeBackgroundColor + title。
 * - clear(title): 清空 badgeText（''）+ 设置 title（保留默认 badge 颜色）。
 */
export interface ActionPresenterPort {
  render(state: Readonly<ActionState>): Promise<void>;
  clear(title: string): Promise<void>;
}
