// src/popup/commands/desired-state.ts
// Task 13 Step 4 — 每个 mutation 的期望态谓词（brief Step 4 逐字 desiredState 对象 + satisfies 穷尽）。
// 用于 MutationReconciler 在 uncertain→bootstrap 后判定远端是否已达成期望态：满足则 reconciled，不满足才安全重试一次。
// 纯函数——仅依赖 domain/protocol 类型，零副作用。
import type { BoardConfig, UserData } from '../../domain/index.js';
import type { MutationMethod, MutationPayload, RpcPayload } from '../../protocol/index.js';

/** 期望态谓词：给定 payload（期望的变更）与权威 UserData，判定变更是否已体现在数据中。 */
export type DesiredStatePredicate<P extends MutationPayload> = (payload: P, data: UserData) => boolean;

/**
 * 每个 mutation 对应一个期望态谓词（brief Step 4 逐字）。
 * satisfies 穷尽保证：新增 mutation 必须补谓词，否则编译失败。
 */
export const desiredState = {
  'stock:add': (payload, data) => {
    const stock = data.watchlist.find((item) => item.code === payload.code);
    return stock !== undefined && payload.groupIds.every((id) => stock.groupIds.includes(id));
  },
  'stock:remove': (payload, data) => payload.codes.every((code) => {
    const stock = data.watchlist.find((item) => item.code === code);
    return payload.groupId === 'g_all' ? stock === undefined : stock !== undefined && !stock.groupIds.includes(payload.groupId);
  }),
  'stock:move': (payload, data) => payload.codes.every((code) => {
    const stock = data.watchlist.find((item) => item.code === code);
    if (!stock) return false;
    const leftSource = payload.fromGroupId === 'g_all' || !stock.groupIds.includes(payload.fromGroupId);
    return leftSource && payload.targetGroupIds.every((id) => stock.groupIds.includes(id));
  }),
  'stock:setPinned': (payload, data) => {
    const stock = data.watchlist.find((item) => item.code === payload.code);
    return Boolean(stock?.pinned[payload.groupId]) === payload.pinned
      && payload.orderedCodes.every((code, index) => data.watchlist.find((item) => item.code === code)?.manualOrder[payload.groupId] === index);
  },
  'stock:setOrder': (payload, data) => payload.orderedCodes.every((code, index) =>
    data.watchlist.find((item) => item.code === code)?.manualOrder[payload.groupId] === index
  ) && data.boardConfig[payload.groupId]?.sortField === 'manual',
  'group:create': (payload, data) => data.groups.some((group) => group.groupId === payload.groupId && group.name === payload.name),
  'group:rename': (payload, data) => data.groups.some((group) => group.groupId === payload.groupId && group.name === payload.name),
  'group:delete': (payload, data) => !data.groups.some((group) => group.groupId === payload.groupId)
    && !Object.hasOwn(data.boardConfig, payload.groupId)
    && data.watchlist.every((stock) => !stock.groupIds.includes(payload.groupId)
      && !Object.hasOwn(stock.manualOrder, payload.groupId)
      && !Object.hasOwn(stock.pinned, payload.groupId)),
  'group:setOrder': (payload, data) => payload.orderedGroupIds.every((id, index) => data.groups[index]?.groupId === id),
  'preferences:patch': (payload, data) => {
    const config = data.boardConfig[payload.groupId];
    return config !== undefined && Object.entries(payload.patch).every(([key, value]) =>
      JSON.stringify(config[key as keyof BoardConfig]) === JSON.stringify(value)
    );
  }
} satisfies { [M in MutationMethod]: DesiredStatePredicate<RpcPayload<M>> };

/**
 * 类型安全的期望态查询：泛型 M 确保方法与 payload 配对。
 * 内部对 desiredState[method] 做单点 cast——satisfies 已保证运行时正确。
 */
export function isDesiredStateSatisfied<M extends MutationMethod>(
  method: M,
  payload: RpcPayload<M>,
  data: UserData
): boolean {
  const predicate = desiredState[method] as (p: RpcPayload<M>, d: UserData) => boolean;
  return predicate(payload, data);
}
