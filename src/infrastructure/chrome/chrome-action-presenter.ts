// src/infrastructure/chrome/chrome-action-presenter.ts
// ChromeActionPresenter：ActionPresenterPort 的 Chrome 实现。
// 包装 chrome.action：render → setBadgeText + setBadgeBackgroundColor + setTitle、
// clear → setBadgeText('') + setTitle。
import type { ActionPresenterPort, ActionState } from '../../application/ports/action-presenter.js';

/**
 * Chrome action 适配器：实现 ActionPresenterPort。
 *
 * - render(state): setBadgeText(state.text) + setBadgeBackgroundColor(state.color) + setTitle(state.title)。
 *   color 为空串时不设置背景色（保留默认），用于空 watchlist 场景。
 * - clear(title): setBadgeText('') + setTitle(title)。
 *   不重置背景色（chrome 会保留上一次的颜色，text='' 时不可见）。
 *
 * 与 v1.3 renderChrome 语义一致：空 watchlist → text='' + title（无 setBadgeBackgroundColor）。
 */
export class ChromeActionPresenter implements ActionPresenterPort {
  async render(state: Readonly<ActionState>): Promise<void> {
    await chrome.action.setBadgeText({ text: state.text });
    if (state.color) {
      await chrome.action.setBadgeBackgroundColor({ color: state.color });
    }
    await chrome.action.setTitle({ title: state.title });
  }

  async clear(title: string): Promise<void> {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title });
  }
}

/** 创建 ChromeActionPresenter 实例的工厂函数。 */
export function createChromeActionPresenter(): ActionPresenterPort {
  return new ChromeActionPresenter();
}
