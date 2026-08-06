// src/application/ports/session-state.ts
// Session 状态端口接口：Application 层通过此接口读写行情退避状态。
// 纯接口——不依赖 infrastructure/Chrome。
// 具体实现（ChromeSessionState）在 infrastructure 层，使用 chrome.storage.session。
// Service Worker 重建后从 session 恢复退避状态，实现持久化。

/**
 * 行情退避状态：记录连续失败次数和下次自动尝试时间。
 * 存储在 chrome.storage.session 的 `quoteBackoff:v2` 键下。
 */
export interface QuoteBackoffState {
  readonly failureCount: number;
  readonly nextAutomaticAttemptAt: number;
}

/**
 * Session 状态端口：读写行情退避状态。
 * - readQuoteBackoff(): 读取退避状态（不存在 / 非法时返回零值）。
 * - writeQuoteBackoff(state): 写入退避状态。
 */
export interface SessionStatePort {
  readQuoteBackoff(): Promise<QuoteBackoffState>;
  writeQuoteBackoff(state: QuoteBackoffState): Promise<void>;
}
