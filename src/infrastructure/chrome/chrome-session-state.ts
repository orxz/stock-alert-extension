// src/infrastructure/chrome/chrome-session-state.ts
// ChromeSessionState：SessionStatePort 的 Chrome 实现。
// 使用 chrome.storage.session 读写 `quoteBackoff:v2` 键。
// Service Worker 重建后从 session 恢复退避状态。
// 非法值（负数 / NaN / 非数字）clamp 到零。
import type {
  SessionStatePort,
  QuoteBackoffState
} from '../../application/ports/session-state.js';

/** chrome.storage.session 中存储退避状态的键名。 */
const BACKOFF_KEY = 'quoteBackoff:v2';

/**
 * 将原始值 clamp 为合法的 QuoteBackoffState。
 * - 非对象 / null → 零值。
 * - failureCount: 非有限 / 负数 / 非整数 → 0。
 * - nextAutomaticAttemptAt: 非有限 / 负数 → 0。
 */
function clampBackoff(raw: unknown): QuoteBackoffState {
  if (typeof raw !== 'object' || raw === null) {
    return { failureCount: 0, nextAutomaticAttemptAt: 0 };
  }
  const obj = raw as Record<string, unknown>;
  const fc = obj.failureCount;
  const na = obj.nextAutomaticAttemptAt;
  const failureCount =
    typeof fc === 'number' && Number.isFinite(fc) && fc >= 0
      ? Math.floor(fc)
      : 0;
  const nextAutomaticAttemptAt =
    typeof na === 'number' && Number.isFinite(na) && na >= 0
      ? na
      : 0;
  return { failureCount, nextAutomaticAttemptAt };
}

/**
 * Chrome session 状态适配器：实现 SessionStatePort。
 * 直接委托 chrome.storage.session 的 get/set。
 */
export class ChromeSessionState implements SessionStatePort {
  async readQuoteBackoff(): Promise<QuoteBackoffState> {
    const result = await chrome.storage.session.get(BACKOFF_KEY);
    return clampBackoff(result[BACKOFF_KEY]);
  }

  async writeQuoteBackoff(state: QuoteBackoffState): Promise<void> {
    await chrome.storage.session.set({
      [BACKOFF_KEY]: {
        failureCount: state.failureCount,
        nextAutomaticAttemptAt: state.nextAutomaticAttemptAt
      }
    });
  }
}

/** 创建 ChromeSessionState 实例的工厂函数。 */
export function createChromeSessionState(): SessionStatePort {
  return new ChromeSessionState();
}
