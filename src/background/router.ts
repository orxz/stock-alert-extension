// src/background/router.ts
// callback Router：将 chrome.runtime.onMessage 回调语义适配到异步 dispatch 流水线。
//
// 核心契约（brief Step 5 逐字）：
// - handle() 同步 return true（声明异步 sendResponse），绝不返回 Promise。
// - respondOnce 守卫保证 sendResponse 恰好调用一次。
// - dispatch() 验证 protocol/request/method/payload 后 await barrier.get()，
//   再委托 handler；成功 → ok:true，失败 → ok:false（AppError 保留 code，非 AppError → INTERNAL）。
// - 每个 RPC 请求发射 rpc scope 的 dispatch:start / dispatch:end span。
import type { Clock } from '../application/ports/clock.js';
import type { DiagnosticSink } from '../application/ports/diagnostics.js';
import type { ErrorCode, AppError } from '../domain/errors.js';
import { rpcRegistry, validateRpcRequest } from '../protocol/registry.js';
import type { RpcMethod, RpcResponseFor } from '../protocol/registry.js';
import { startSpan } from '../application/diagnostics/span.js';
import type { InitializationBarrier } from './initialization-barrier.js';
import { handlers } from './rpc-handlers.js';
import type { AppServices, RpcHandler } from './rpc-handlers.js';

/** createRouter 依赖。 */
export interface RouterDeps {
  readonly barrier: InitializationBarrier<AppServices>;
  readonly sink: DiagnosticSink;
  readonly clock: Clock;
}

/** createRouter 返回的 router 句柄。 */
export interface Router {
  handle(
    request: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: RpcResponseFor<RpcMethod>) => void
  ): true;
}

/** 从请求中尽力提取 requestId（用于错误响应回显；非法时返回空串）。 */
function readRequestId(request: unknown): string {
  if (typeof request === 'object' && request !== null) {
    const env = request as Record<string, unknown>;
    if (typeof env.requestId === 'string' && env.requestId.length > 0) {
      return env.requestId;
    }
  }
  return '';
}

/** 构造 ok:false 响应。 */
function errorResponse(
  requestId: string,
  code: ErrorCode,
  message: string,
  retryable: boolean
): RpcResponseFor<RpcMethod> {
  return { protocol: 2, requestId, ok: false, error: { code, message, retryable } };
}

/** 判断值是否为 AppError（结构化错误模型）。 */
function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    'retryable' in value &&
    typeof (value as AppError).message === 'string' &&
    typeof (value as AppError).retryable === 'boolean'
  );
}

/** 将任意错误映射为安全 AppError：已知 AppError 保留 code/message/retryable；其余 → INTERNAL（不泄漏 stack）。 */
function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return { code: 'INTERNAL', message: 'internal error', retryable: false };
}

/**
 * 创建 callback Router。
 *
 * handle 同步注册后立即返回 true；dispatch 异步执行并经 respondOnce 恰好回调一次 sendResponse。
 */
export function createRouter(deps: RouterDeps): Router {
  const { barrier, sink, clock } = deps;

  async function dispatch(request: unknown): Promise<RpcResponseFor<RpcMethod>> {
    const startedAt = clock.now();
    const requestId = readRequestId(request);
    const span = startSpan(sink, {
      timestamp: startedAt,
      version: '2.0.0',
      requestId,
      scope: 'rpc',
      type: 'dispatch'
    });
    const endSpan = (outcome: 'ok' | 'failed', errorCode?: ErrorCode): void => {
      span.end({
        timestamp: clock.now(),
        version: '2.0.0',
        requestId,
        scope: 'rpc',
        type: 'dispatch',
        outcome,
        durationMs: clock.now() - startedAt,
        errorCode
      });
    };

    try {
      // ── Layer 1: 请求必须是对象 ──
      if (typeof request !== 'object' || request === null) {
        endSpan('failed', 'PROTOCOL_MISMATCH');
        return errorResponse(requestId, 'PROTOCOL_MISMATCH', 'request must be an object', false);
      }
      const envelope = request as Record<string, unknown>;

      // ── Layer 2: protocol === 2 ──
      if (envelope.protocol !== 2) {
        endSpan('failed', 'PROTOCOL_MISMATCH');
        return errorResponse(requestId, 'PROTOCOL_MISMATCH', 'protocol must be 2', false);
      }

      // ── Layer 3: requestId 非空字符串 ──
      if (typeof envelope.requestId !== 'string' || envelope.requestId.length === 0) {
        endSpan('failed', 'PROTOCOL_MISMATCH');
        return errorResponse(requestId, 'PROTOCOL_MISMATCH', 'requestId must be a non-empty string', false);
      }
      const reqId = envelope.requestId;

      // ── Layer 4: method 在注册表 ──
      const methodName = envelope.method;
      if (typeof methodName !== 'string' || !(methodName in rpcRegistry)) {
        endSpan('failed', 'UNKNOWN_METHOD');
        return errorResponse(reqId, 'UNKNOWN_METHOD', `unknown method: ${String(methodName)}`, false);
      }

      // ── Layer 5: payload 校验（protocol/requestId/method 已通过，此处仅 payload 可能失败）──
      const validated = validateRpcRequest(request);
      if (!validated.ok) {
        endSpan('failed', 'INVALID_PAYLOAD');
        return errorResponse(reqId, 'INVALID_PAYLOAD', validated.errors.join('; '), false);
      }

      // ── Layer 6: 等待初始化屏障 → 委托 handler ──
      const services = await barrier.get();
      const result = await (handlers[validated.method] as RpcHandler<RpcMethod>)(validated.payload, services);
      endSpan('ok');
      return { protocol: 2, requestId: reqId, ok: true, data: result };
    } catch (error) {
      const appError = toAppError(error);
      endSpan('failed', appError.code);
      return { protocol: 2, requestId, ok: false, error: appError };
    }
  }

  function handle(
    request: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: RpcResponseFor<RpcMethod>) => void
  ): true {
    let responded = false;
    const respondOnce = (response: RpcResponseFor<RpcMethod>): void => {
      if (responded) return;
      responded = true;
      sendResponse(response);
    };
    void dispatch(request).then(respondOnce, (error) =>
      respondOnce({
        protocol: 2,
        requestId: readRequestId(request),
        ok: false,
        error: toAppError(error)
      })
    );
    return true;
  }

  return { handle };
}
