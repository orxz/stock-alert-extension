// tests/helpers/fake-session-state.ts
// 内存 SessionStatePort：用于测试。跟踪读写调用。
import type {
  SessionStatePort,
  QuoteBackoffState
} from '../../src/application/ports/session-state.js';

/**
 * 内存 SessionStatePort：确定性、无 IO 延迟。
 * - 初始状态为 { failureCount: 0, nextAutomaticAttemptAt: 0 }。
 * - readQuoteBackoff() 返回当前状态的副本。
 * - writeQuoteBackoff(state) 深拷贝写入。
 * - readCount / writeCount 跟踪调用次数。
 */
export class FakeSessionState implements SessionStatePort {
  private state: QuoteBackoffState = { failureCount: 0, nextAutomaticAttemptAt: 0 };
  readCount = 0;
  writeCount = 0;

  async readQuoteBackoff(): Promise<QuoteBackoffState> {
    this.readCount += 1;
    return { ...this.state };
  }

  async writeQuoteBackoff(state: QuoteBackoffState): Promise<void> {
    this.writeCount += 1;
    this.state = { ...state };
  }

  /** 测试辅助：直接设置内部状态（不经过 writeCount）。 */
  setState(state: QuoteBackoffState): void {
    this.state = { ...state };
  }

  /** 测试辅助：获取内部状态引用（只读断言用）。 */
  peek(): QuoteBackoffState {
    return this.state;
  }
}
