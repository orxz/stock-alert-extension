// tests/helpers/fake-action-presenter.ts
// 内存 ActionPresenterPort：测试专用。记录 render/clear 调用。
import type {
  ActionPresenterPort,
  ActionState
} from '../../src/application/ports/action-presenter.js';

/** render 调用记录。 */
export interface RenderCall {
  readonly text: string;
  readonly color: string;
  readonly title: string;
}

/** clear 调用记录。 */
export interface ClearCall {
  readonly title: string;
}

/**
 * 内存 ActionPresenterPort：确定性、无 IO 延迟。
 * - render(state): 记录到 renderCalls。
 * - clear(title): 记录到 clearCalls。
 * - lastRender / lastClear: 快捷访问最后一次调用。
 */
export class FakeActionPresenter implements ActionPresenterPort {
  readonly renderCalls: RenderCall[] = [];
  readonly clearCalls: ClearCall[] = [];

  async render(state: Readonly<ActionState>): Promise<void> {
    this.renderCalls.push({
      text: state.text,
      color: state.color,
      title: state.title
    });
  }

  async clear(title: string): Promise<void> {
    this.clearCalls.push({ title });
  }

  /** 最后一次 render 调用（undefined 表示未调用）。 */
  get lastRender(): RenderCall | undefined {
    return this.renderCalls[this.renderCalls.length - 1];
  }

  /** 最后一次 clear 调用（undefined 表示未调用）。 */
  get lastClear(): ClearCall | undefined {
    return this.clearCalls[this.clearCalls.length - 1];
  }

  /** 测试辅助：清空所有调用记录。 */
  reset(): void {
    this.renderCalls.length = 0;
    this.clearCalls.length = 0;
  }
}
