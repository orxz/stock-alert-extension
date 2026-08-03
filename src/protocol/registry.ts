// src/protocol/registry.ts
// RPC v2 单一注册表：每个方法绑定 payload 校验器与 result 类型标记。
// Popup Client 与 Background Router 共享此注册表——不维护平行字符串清单或 payload/result 映射。
// 新增/重命名方法只需在此处登记一处；exhaustiveness 测试与派生类型保证消费者同步。
import type { Stock } from '../domain/stock.js';
import type { Group } from '../domain/group.js';
import type { BoardConfig } from '../domain/board-config.js';
import type { QuoteSnapshot, StockSearchResult } from '../domain/quote.js';

import type { ValidationResult, ValidatedValue } from './validators.js';
import {
  strictObject,
  partialStrictObject,
  boolean,
  literalEnum,
  duplicateFreeArray,
  maxItems,
  stockCode,
  groupId as groupIdValidator,
  revision,
  groupName,
  nonEmptyTrimmedString
} from './validators.js';
import type {
  RpcRequest,
  RpcResponse,
  MutationResult,
  BootstrapResult,
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

/** 单次操作涉及的最大股票代码数（与 v1.3 自选股上限一致）。 */
const MAX_STOCK_CODES = 500;

// ===== 通用子校验器（被多个方法复用）=====

/** ≤500、去重、每项合法的股票代码数组。 */
const stockCodes = maxItems(MAX_STOCK_CODES, duplicateFreeArray(stockCode()));

/** 去重、每项合法的分组 ID 数组（容错接受 g_all 计算视图；语义校验由 Application 层处理）。 */
const groupIds = duplicateFreeArray(groupIdValidator());

/** BoardConfig patch 白名单：仅允许 domain BoardConfig 的 4 个字段，拒绝未知键与原型污染键。 */
const boardConfigPatch = partialStrictObject({
  viewMode: literalEnum('list', 'grid'),
  sortField: literalEnum('manual', 'addedAt', 'name', 'price', 'change', 'changePercent', 'amount'),
  sortDirection: literalEnum('asc', 'desc'),
  priceHidden: boolean()
});

// ===== 方法特定 payload 校验器 =====

const validateEmptyObject = strictObject({});
const validateQuoteRefresh = strictObject({ codes: stockCodes, force: boolean() });
const validateStockSearch = strictObject({ query: nonEmptyTrimmedString() });
const validateAddStock = strictObject({
  expectedRevision: revision(),
  code: stockCode(),
  name: nonEmptyTrimmedString(),
  groupIds: groupIds
});
const validateRemoveStock = strictObject({
  expectedRevision: revision(),
  codes: stockCodes,
  groupId: groupIdValidator()
});
const validateMoveStock = strictObject({
  expectedRevision: revision(),
  codes: stockCodes,
  fromGroupId: groupIdValidator(),
  targetGroupIds: groupIds
});
const validateSetPinned = strictObject({
  expectedRevision: revision(),
  groupId: groupIdValidator(),
  code: stockCode(),
  pinned: boolean(),
  orderedCodes: stockCodes
});
const validateSetStockOrder = strictObject({
  expectedRevision: revision(),
  groupId: groupIdValidator(),
  orderedCodes: stockCodes
});
const validateCreateGroup = strictObject({
  expectedRevision: revision(),
  groupId: groupIdValidator(),
  name: groupName()
});
const validateRenameGroup = strictObject({
  expectedRevision: revision(),
  groupId: groupIdValidator(),
  name: groupName()
});
const validateDeleteGroup = strictObject({
  expectedRevision: revision(),
  groupId: groupIdValidator()
});
const validateSetGroupOrder = strictObject({
  expectedRevision: revision(),
  orderedGroupIds: groupIds
});
const validatePatchPreferences = strictObject({
  expectedRevision: revision(),
  groupId: groupIdValidator(),
  patch: boardConfigPatch
});

// ===== Contract 类型与 method 标记（brief Step 5 逐字）=====

type Contract<P, R> = Readonly<{
  validate: (input: unknown) => ValidationResult<P>;
  resultType: R | undefined;
}>;

// resultType 运行时为 undefined，仅用于 NonNullable<typeof rpcRegistry[M]['resultType']> 提取 R。
const method = <P, R>(validate: Contract<P, R>['validate']): Contract<P, R> => ({
  validate,
  resultType: undefined
});

// ===== 单一注册表：13 个方法（顺序与 brief Step 1 methods 数组一致）=====

export const rpcRegistry = {
  'app:bootstrap': method<Readonly<Record<never, never>>, BootstrapResult>(validateEmptyObject),
  'quote:refresh': method<QuoteRefreshPayload, QuoteSnapshot>(validateQuoteRefresh),
  'stock:search': method<StockSearchPayload, readonly StockSearchResult[]>(validateStockSearch),
  'stock:add': method<AddStockPayload, MutationResult<Stock>>(validateAddStock),
  'stock:remove': method<RemoveStockPayload, MutationResult<null>>(validateRemoveStock),
  'stock:move': method<MoveStockPayload, MutationResult<null>>(validateMoveStock),
  'stock:setPinned': method<SetPinnedPayload, MutationResult<null>>(validateSetPinned),
  'stock:setOrder': method<SetStockOrderPayload, MutationResult<null>>(validateSetStockOrder),
  'group:create': method<CreateGroupPayload, MutationResult<Group>>(validateCreateGroup),
  'group:rename': method<RenameGroupPayload, MutationResult<null>>(validateRenameGroup),
  'group:delete': method<DeleteGroupPayload, MutationResult<null>>(validateDeleteGroup),
  'group:setOrder': method<SetGroupOrderPayload, MutationResult<null>>(validateSetGroupOrder),
  'preferences:patch': method<PatchPreferencesPayload, MutationResult<BoardConfig>>(validatePatchPreferences)
} as const;

// ===== 派生类型（从 rpcRegistry 推导，绝不维护平行映射）=====

export type RpcMethod = keyof typeof rpcRegistry;
export type RpcPayload<M extends RpcMethod> = ValidatedValue<(typeof rpcRegistry)[M]['validate']>;
export type RpcResult<M extends RpcMethod> = NonNullable<(typeof rpcRegistry)[M]['resultType']>;
export type RpcRequestFor<M extends RpcMethod> = RpcRequest<M, RpcPayload<M>>;
export type RpcResponseFor<M extends RpcMethod> = RpcResponse<RpcResult<M>>;
export type MutationMethod = Exclude<RpcMethod, 'app:bootstrap' | 'quote:refresh' | 'stock:search'>;
export type MutationPayload = RpcPayload<MutationMethod>;

// ===== 请求信封校验：protocol/requestId/method/payload 四层防线 =====

/** validateRpcRequest 成功时的结果：已校验的 method 与 payload。 */
export type ValidateRpcRequestResult =
  | { readonly ok: true; readonly method: RpcMethod; readonly payload: RpcPayload<RpcMethod> }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * 校验一条入站 RPC 请求信封。
 * 顺序：对象性 → protocol===2 → requestId 非空 → method 在注册表中 → payload 经方法校验器。
 * 任意一层失败立即返回 ok:false 与错误清单；成功返回 ok:true 与校验后的 payload。
 */
export function validateRpcRequest(input: unknown): ValidateRpcRequestResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['request must be an object'] };
  }
  const envelope = input as Record<string, unknown>;
  if (envelope.protocol !== 2) {
    return { ok: false, errors: ['protocol must be 2'] };
  }
  if (typeof envelope.requestId !== 'string' || envelope.requestId.length === 0) {
    return { ok: false, errors: ['requestId must be a non-empty string'] };
  }
  const methodName = envelope.method;
  if (typeof methodName !== 'string' || !(methodName in rpcRegistry)) {
    return { ok: false, errors: [`unknown method: ${String(methodName)}`] };
  }
  const contract = rpcRegistry[methodName as RpcMethod];
  const result = contract.validate(envelope.payload);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }
  return { ok: true, method: methodName as RpcMethod, payload: result.value as RpcPayload<RpcMethod> };
}
