// src/domain/errors.ts
// 稳定错误码与应用错误模型。ErrorCode 联合贯穿 RPC、Application 和诊断事件。
// 设计文档 §11 定义了完整的错误码集合与 retryable 策略。

/**
 * 稳定错误码：RPC、Application 和诊断共享。
 * 堆栈与原始 Provider 响应不通过 RPC 暴露，只传递安全用户文案与 retryable 标记。
 */
export type ErrorCode =
  | 'UNKNOWN_METHOD'
  | 'INVALID_PAYLOAD'
  | 'PROTOCOL_MISMATCH'
  | 'STORAGE_UNAVAILABLE'
  | 'QUOTE_TIMEOUT'
  | 'QUOTE_UNAVAILABLE'
  | 'SEARCH_UNAVAILABLE'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'INTERNAL';

/**
 * 应用错误：包含稳定错误码、安全用户文案和可重试标记。
 * 每个写命令和远端请求失败时统一转换为 AppError。
 */
export interface AppError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}
