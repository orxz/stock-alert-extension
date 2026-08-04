// src/popup/commands/mutation-reconciler.ts
// Task 13 Step 5 — reconcile-before-retry。
// 路径：
//   pending → call → confirmed（成功）
//   pending → call → 非 RpcUncertainError → failed
//   pending → call → RpcUncertainError → uncertain → bootstrap/confirmed → desiredState 满足 → reconciled（不重试）
//   pending → call → RpcUncertainError → uncertain → bootstrap → desiredState 不满足 → 用新 revision 重试一次
//     重试成功 → confirmed；重试非 uncertain（含 CONFLICT）→ failed（bootstrap 数据已安装）；重试再次 uncertain → 保持 uncertain（不再重试）
import type { MutationMethod, RpcPayload } from '../../protocol/index.js';
import type { UserDataRevision } from '../../domain/index.js';
import type { ClientError } from '../store/state.js';
import type { Store } from '../store/store.js';
import type { RpcClient } from '../rpc-client.js';
import { RpcUncertainError } from '../rpc-client.js';
import { isDesiredStateSatisfied } from './desired-state.js';

/**
 * 将任意错误映射为客户端安全的 { code, message, retryable }。
 * - AppError/RpcClientError 形态（含 code/message/retryable）→ 原样提取（code 非 string 回退 UNKNOWN）。
 * - 其他（字符串/对象/undefined）→ { code: 'UNKNOWN', message: '未知错误', retryable: false }。
 */
export function toSafeClientError(error: unknown): ClientError {
  // 形态校验：必须同时含 code/message/retryable，且 retryable 为 boolean（RpcUncertainError 无 retryable → 回退 UNKNOWN）。
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    'retryable' in error
  ) {
    const e = error as { code: unknown; message: unknown; retryable: unknown };
    if (typeof e.retryable === 'boolean') {
      return {
        code: typeof e.code === 'string' ? e.code : 'UNKNOWN',
        message: typeof e.message === 'string' ? e.message : '未知错误',
        retryable: e.retryable
      };
    }
  }
  return { code: 'UNKNOWN', message: '未知错误', retryable: false };
}

/**
 * 写命令对账器：在重试前先 bootstrap 对账，避免盲重试造成重复提交。
 * 允许至多一次自动重试；第二次 uncertain 保持可见，需用户手动重试。
 */
export class MutationReconciler {
  constructor(
    private readonly rpc: RpcClient,
    private readonly store: Store
  ) {}

  async execute<M extends MutationMethod>(method: M, payload: RpcPayload<M>, key: string): Promise<void> {
    this.store.dispatch({ type: 'mutation/pending', key });
    try {
      const result = await this.rpc.call(method, payload);
      this.store.dispatch({ type: 'mutation/confirmed', key, result });
    } catch (error) {
      if (!(error instanceof RpcUncertainError)) {
        return this.fail(key, error);
      }
      // 第一次 uncertain：bootstrap 对账
      this.store.dispatch({ type: 'mutation/uncertain', key });
      const bootstrap = await this.rpc.call('app:bootstrap', {});
      this.store.dispatch({ type: 'bootstrap/confirmed', result: bootstrap });
      if (isDesiredStateSatisfied(method, payload, bootstrap.userData)) {
        // 远端已达成期望态 → reconciled（bootstrap 已安装权威快照，无需重试）
        return this.confirmFromBootstrap(key);
      }
      // 期望态未达成：用 resync 后的 revision 安全重试一次
      try {
        const retried = await this.rpc.call(method, {
          ...(payload as object),
          expectedRevision: bootstrap.revision as UserDataRevision
        } as RpcPayload<M>);
        this.store.dispatch({ type: 'mutation/confirmed', key, result: retried });
      } catch (retryError) {
        if (retryError instanceof RpcUncertainError) {
          // 第二次 uncertain：不再重试，保持 uncertain 可见（需用户手动重试）
          this.store.dispatch({ type: 'mutation/uncertain', key });
          return;
        }
        // 非 uncertain（含 CONFLICT）：failed（bootstrap 数据已在前一步安装）
        return this.fail(key, retryError);
      }
    }
  }

  private fail(key: string, error: unknown): void {
    this.store.dispatch({ type: 'mutation/failed', key, error: toSafeClientError(error) });
  }

  private confirmFromBootstrap(key: string): void {
    // bootstrap/confirmed 已在前一步安装权威快照；此处仅清除 mutation 异步条目。
    this.store.dispatch({ type: 'mutation/reconciled', key });
  }
}
