// src/protocol/error-codes.ts
// RPC 错误模型：单一真相源在 src/domain/errors.ts。此处仅重导出，避免重复定义 ErrorCode/AppError。
// RpcError 与 domain 的 AppError 结构相同（{ code, message, retryable }）；别名导出符合"共享类型"原则。
export type { ErrorCode } from '../domain/errors.js';
export type { AppError as RpcError } from '../domain/errors.js';
