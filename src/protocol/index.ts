// src/protocol/index.ts
// Protocol 层 barrel export：单一 RPC v2 注册表、消息信封与校验组合子。
// 消费者（application / background / popup）从这里或具体子模块导入——两者等价。
// 错误模型重导出自 domain（单一真相源）；payload/result 类型从 messages 暴露；校验组合子从 validators 暴露。
export type { ErrorCode, RpcError } from './error-codes.js';
export type {
  RpcRequest,
  RpcResponse,
  MutationResult,
  BootstrapResult,
  MutationMeta,
  AddStockPayload,
  RemoveStockPayload,
  MoveStockPayload,
  SetPinnedPayload,
  SetStockOrderPayload,
  CreateGroupPayload,
  RenameGroupPayload,
  DeleteGroupPayload,
  SetGroupOrderPayload,
  PatchPreferencesPayload,
  QuoteRefreshPayload,
  StockSearchPayload
} from './messages.js';
export type { ValidationResult, Validator, ValidatedValue } from './validators.js';
export {
  strictObject,
  partialStrictObject,
  string,
  boolean,
  literalEnum,
  array,
  duplicateFreeArray,
  maxItems,
  stockCode,
  groupId,
  revision,
  groupName,
  nonEmptyTrimmedString
} from './validators.js';
export { rpcRegistry, validateRpcRequest } from './registry.js';
export type {
  RpcMethod,
  RpcPayload,
  RpcResult,
  RpcRequestFor,
  RpcResponseFor,
  MutationMethod,
  MutationPayload,
  ValidateRpcRequestResult
} from './registry.js';
