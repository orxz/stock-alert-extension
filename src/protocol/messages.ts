// src/protocol/messages.ts
// RPC v2 消息信封与 payload 类型。所有跨进程消息遵循 RpcRequest<M,P> / RpcResponse<R> 形状。
// MutationResult / BootstrapResult 是协议消息形状，属 protocol 层（brief Step 3 决策：放此处而非 domain）。
import type { StockCode, GroupId, UserDataRevision } from '../domain/brands.js';
import type { Stock } from '../domain/stock.js';
import type { Group } from '../domain/group.js';
import type { BoardConfig, UserData } from '../domain/board-config.js';
import type { QuoteSnapshot } from '../domain/quote.js';
import type { RpcError } from './error-codes.js';

// ===== Step 3: 结果类型 =====

/** 写命令结果：新值 + 完整 UserData 快照 + 新 revision（乐观并发控制）。 */
export type MutationResult<T> = Readonly<{
  value: T;
  userData: UserData;
  revision: UserDataRevision;
}>;

/** Bootstrap 结果：版本 + UserData + revision + 行情快照（Popup 冷启动的完整初始状态）。 */
export type BootstrapResult = Readonly<{
  version: '2.0.0';
  userData: UserData;
  revision: UserDataRevision;
  quoteSnapshot: QuoteSnapshot;
}>;

// ===== Step 3: 消息信封 =====

/** 请求信封：protocol 固定 2，requestId 由 Popup 生成用于配对响应。 */
export type RpcRequest<M extends string, P> = Readonly<{
  protocol: 2;
  requestId: string;
  method: M;
  payload: P;
}>;

/** 响应信封：判别联合，ok:true 携带 data，ok:false 携带 RpcError（不含堆栈/Provider 原文）。 */
export type RpcResponse<R> =
  | Readonly<{ protocol: 2; requestId: string; ok: true; data: R }>
  | Readonly<{ protocol: 2; requestId: string; ok: false; error: RpcError }>;

// ===== Step 4: payload 类型（精确 mutation 与 query payload）=====

/** 写命令公共元：期望的 revision，用于乐观并发冲突检测。 */
export type MutationMeta = Readonly<{ expectedRevision: UserDataRevision }>;

export type AddStockPayload = MutationMeta & Readonly<{
  code: StockCode;
  name: string;
  groupIds: readonly GroupId[];
}>;
export type RemoveStockPayload = MutationMeta & Readonly<{
  codes: readonly StockCode[];
  groupId: GroupId;
}>;
export type MoveStockPayload = MutationMeta & Readonly<{
  codes: readonly StockCode[];
  fromGroupId: GroupId;
  targetGroupIds: readonly GroupId[];
}>;
export type SetPinnedPayload = MutationMeta & Readonly<{
  groupId: GroupId;
  code: StockCode;
  pinned: boolean;
  orderedCodes: readonly StockCode[];
}>;
export type SetStockOrderPayload = MutationMeta & Readonly<{
  groupId: GroupId;
  orderedCodes: readonly StockCode[];
}>;
export type CreateGroupPayload = MutationMeta & Readonly<{
  groupId: GroupId;
  name: string;
}>;
export type RenameGroupPayload = MutationMeta & Readonly<{
  groupId: GroupId;
  name: string;
}>;
export type DeleteGroupPayload = MutationMeta & Readonly<{
  groupId: GroupId;
}>;
export type SetGroupOrderPayload = MutationMeta & Readonly<{
  orderedGroupIds: readonly GroupId[];
}>;
export type PatchPreferencesPayload = MutationMeta & Readonly<{
  groupId: GroupId;
  patch: Readonly<Partial<BoardConfig>>;
}>;
export type QuoteRefreshPayload = Readonly<{
  codes: readonly StockCode[];
  force: boolean;
}>;
export type StockSearchPayload = Readonly<{
  query: string;
}>;

// 重导出 Stock/Group 仅为类型完整性（MutationResult<Stock>/MutationResult<Group> 在 registry 中引用）。
export type { Stock, Group };
