// tests/helpers/fake-rpc-client.ts
// Task 13 — 可编程 mock RpcClient：按方法队列消费响应，记录调用以供断言。
// 队列模式：queueSuccess / queueTimeout / queueError / queueBootstrap。
// 若某方法未入队响应，默认抛 RpcUncertainError（模拟无响应）。
import type { RpcClient } from '../../src/popup/rpc-client.js';
import { RpcUncertainError } from '../../src/popup/rpc-client.js';
import type { RpcMethod, RpcPayload, RpcResult } from '../../src/protocol/index.js';
import type { BootstrapResult } from '../../src/protocol/index.js';

type QueuedResponse =
  | { readonly kind: 'success'; readonly data: unknown }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'error'; readonly code: string; readonly message: string; readonly retryable: boolean };

interface RecordedCall {
  readonly method: RpcMethod;
  readonly payload: unknown;
}

/**
 * 可编程 RpcClient mock。
 * - queue* 方法向指定方法的响应队列追加条目；call 时按 FIFO 消费。
 * - count/payloadsFor/secondPayload 提供断言视图。
 */
export class FakeRpcClient implements RpcClient {
  private readonly queues = new Map<RpcMethod, QueuedResponse[]>();
  private readonly calls: RecordedCall[] = [];

  queueSuccess<M extends RpcMethod>(method: M, data: RpcResult<M>): this {
    return this.enqueue(method, { kind: 'success', data });
  }

  queueTimeout<M extends RpcMethod>(method: M): this {
    return this.enqueue(method, { kind: 'timeout' });
  }

  queueError<M extends RpcMethod>(
    method: M,
    error: { readonly code: string; readonly message: string; readonly retryable: boolean }
  ): this {
    return this.enqueue(method, { kind: 'error', code: error.code, message: error.message, retryable: error.retryable });
  }

  /** 等价于 queueSuccess('app:bootstrap', result)。 */
  queueBootstrap(result: BootstrapResult): this {
    return this.enqueue('app:bootstrap', { kind: 'success', data: result });
  }

  private enqueue(method: RpcMethod, response: QueuedResponse): this {
    const arr = this.queues.get(method) ?? [];
    arr.push(response);
    this.queues.set(method, arr);
    return this;
  }

  /** 某方法的调用次数。 */
  count(method: RpcMethod): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  /** 某方法全部调用的 payload（按调用顺序）。 */
  payloadsFor(method: RpcMethod): readonly unknown[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.payload);
  }

  /** 全部调用记录。 */
  recordedCalls(): readonly RecordedCall[] {
    return [...this.calls];
  }

  /**
   * "第二个 payload"：第一个被调用 ≥2 次的方法的第二次 payload。
   * 用于断言 retry 路径携带 resync 后的 expectedRevision。
   */
  get secondPayload(): unknown {
    for (const call of this.calls) {
      const sameMethod = this.calls.filter((c) => c.method === call.method);
      if (sameMethod.length >= 2) return sameMethod[1].payload;
    }
    return undefined;
  }

  call<M extends RpcMethod>(method: M, payload: RpcPayload<M>): Promise<RpcResult<M>> {
    this.calls.push({ method, payload });
    const queue = this.queues.get(method);
    const response = queue?.shift();
    if (!response) {
      // 未入队 → 模拟无响应（不确定）
      return Promise.reject(new RpcUncertainError(`FakeRpcClient: ${method} 未入队响应`));
    }
    if (response.kind === 'success') {
      return Promise.resolve(response.data as RpcResult<M>);
    }
    if (response.kind === 'timeout') {
      return Promise.reject(new RpcUncertainError(`FakeRpcClient: ${method} 模拟超时`));
    }
    const err = new Error(response.message) as Error & { code: string; retryable: boolean };
    err.code = response.code;
    err.retryable = response.retryable;
    return Promise.reject(err);
  }
}
