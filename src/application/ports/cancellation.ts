// src/application/ports/cancellation.ts
// 协作取消端口：纯 ES2022 接口，不引用 DOM AbortSignal。
// Application/Infrastructure 通过此接口传播取消信号；Chrome fetch 桥接在 Provider 内完成。
// 测试使用 createCancellationSource() 创建确定性 token；生产可注入真实 AbortController 包装。

/**
 * 取消令牌：只读接口，消费者通过 aborted 判断是否已取消，
 * 通过 onCancel 注册取消回调（返回取消订阅函数）。
 *
 * 设计约束：
 * - 纯 ES2022，不引用 DOM/WebWorker AbortSignal。
 * - onCancel 注册的 listener 在 cancel() 调用时同步触发。
 * - 若 token 已取消，onCancel 立即同步触发 listener。
 */
export interface CancellationToken {
  readonly aborted: boolean;
  onCancel(listener: () => void): () => void;
}

/**
 * 取消源：创建 token 并提供 cancel() 方法。
 * 生产/测试通过 createCancellationSource() 构造；cancel() 幂等。
 */
export interface CancellationSource {
  readonly token: CancellationToken;
  cancel(): void;
}

/**
 * 创建取消源：token 初始 aborted=false，cancel() 后 aborted=true 并触发所有 listener。
 * cancel() 幂等——多次调用安全，listener 仅触发一次。
 */
export function createCancellationSource(): CancellationSource {
  let aborted = false;
  const listeners = new Set<() => void>();

  const token: CancellationToken = {
    get aborted() {
      return aborted;
    },
    onCancel(listener: () => void): () => void {
      if (aborted) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };

  return {
    token,
    cancel(): void {
      if (aborted) return;
      aborted = true;
      const current = [...listeners];
      listeners.clear();
      for (const listener of current) listener();
    }
  };
}
