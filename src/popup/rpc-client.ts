// src/popup/rpc-client.ts
// Task 13 Step 3 — typed callback RPC Client。
// 包装 chrome.runtime.sendMessage 的 callback 形态，提供类型安全的 call<M>()。
// 错误区分（brief Step 3）：
//   - chrome.runtime.lastError / 空响应 / protocol mismatch / requestId mismatch / malformed → 明确失败（非不确定）。
//   - 10s 超时（已发送、响应丢失）→ RpcUncertainError（不确定是否已提交）。
// 依赖：popup 用 DOM lib（crypto.randomUUID / setTimeout / clearTimeout 均可用）。
import type { RpcMethod, RpcPayload, RpcResult, RpcRequest, RpcResponse } from '../protocol/index.js';

/** RpcClient 接口（brief Step 3 逐字）。 */
export interface RpcClient {
  call<M extends RpcMethod>(method: M, payload: RpcPayload<M>, options?: { timeoutMs?: number }): Promise<RpcResult<M>>;
}

/** 发送后超时或响应丢失——不确定 mutation 是否已提交到远端。 */
export class RpcUncertainError extends Error {
  readonly code = 'RPC_UNCERTAIN' as const;
  constructor(message = 'RPC uncertain: response lost or timed out') {
    super(message);
    this.name = 'RpcUncertainError';
  }
}

/** 明确的 RPC 错误：携带稳定 code 与 retryable，与 AppError 形态一致（code 放宽为 string）。 */
export interface RpcClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;
}

/** 构造明确的 RpcClientError（非不确定）。 */
export function createRpcClientError(code: string, message: string, retryable: boolean): RpcClientError {
  const err = new Error(message) as RpcClientError;
  Object.defineProperty(err, 'code', { value: code, enumerable: true });
  Object.defineProperty(err, 'retryable', { value: retryable, enumerable: true });
  err.name = 'RpcClientError';
  return err;
}

/** chrome.runtime.sendMessage 的 callback 形态（注入便于测试）。 */
export type SendMessage = (
  message: RpcRequest<string, unknown>,
  callback: (response?: unknown) => void
) => void;

/** 默认超时 10 秒（brief Step 3）。 */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * 读取 chrome.runtime.lastError（兼容 string | { message } 形态）。
 * lastError 仅在 callback 派发期间由 Chrome 设置；此处同步读取。
 */
function readLastError(): string | undefined {
  const chromeLike = (globalThis as { chrome?: { runtime?: { lastError?: unknown } } }).chrome;
  const last = chromeLike?.runtime?.lastError;
  if (last === undefined || last === null) return undefined;
  if (typeof last === 'string') return last;
  if (typeof last === 'object' && last !== null && 'message' in last) {
    const msg = (last as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return String(last);
}

/**
 * 基于 chrome.runtime.sendMessage callback 的 RpcClient 实现。
 * 每次 call 生成唯一 requestId（crypto.randomUUID），构造 RpcRequest 信封，等待 callback 响应或超时。
 */
export class CallbackRpcClient implements RpcClient {
  constructor(private readonly sendMessage: SendMessage) {}

  call<M extends RpcMethod>(method: M, payload: RpcPayload<M>, options?: { timeoutMs?: number }): Promise<RpcResult<M>> {
    return new Promise<RpcResult<M>>((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const request: RpcRequest<M, RpcPayload<M>> = { protocol: 2, requestId, method, payload };
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let settled = false;

      // 超时定时器：发送后响应丢失 → RpcUncertainError（不确定是否已提交）。
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new RpcUncertainError(`RPC ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.sendMessage(request, (response) => {
        if (settled) return; // 已超时或已处理——丢弃迟到的响应
        settled = true;
        clearTimeout(timer);

        // chrome.runtime.lastError：连接失败（明确失败，非不确定）
        const lastError = readLastError();
        if (lastError) {
          return reject(createRpcClientError('CONNECTION_FAILED', lastError, false));
        }

        // 空响应（callback 无参数）：明确失败
        if (response === undefined || response === null) {
          return reject(createRpcClientError('EMPTY_RESPONSE', 'RPC 空响应', false));
        }

        const resp = response as Partial<RpcResponse<unknown>>;

        // 协议不匹配：明确失败（PROTOCOL_MISMATCH）
        if (resp.protocol !== 2) {
          return reject(createRpcClientError('PROTOCOL_MISMATCH', 'RPC 协议不匹配', false));
        }

        // requestId 不匹配：明确失败（串扰/旧响应）
        if (resp.requestId !== requestId) {
          return reject(createRpcClientError('REQUEST_ID_MISMATCH', 'RPC requestId 不匹配', false));
        }

        if (resp.ok === true) {
          return resolve(resp.data as RpcResult<M>);
        }

        if (resp.ok === false) {
          const err = resp.error as { code?: unknown; message?: unknown; retryable?: unknown } | undefined;
          return reject(createRpcClientError(
            typeof err?.code === 'string' ? err.code : 'UNKNOWN',
            typeof err?.message === 'string' ? err.message : '未知错误',
            Boolean(err?.retryable)
          ));
        }

        // ok 字段缺失：malformed
        return reject(createRpcClientError('MALFORMED_RESPONSE', 'RPC 响应格式错误', false));
      });
    });
  }
}
