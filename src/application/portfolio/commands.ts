// src/application/portfolio/commands.ts
// PortfolioCommands：10 个原子最终态写命令，每个方法恰好调一次 UserDataRepository.mutate()。
// change 函数修改 MutableUserData 草稿后返回 value；Coordinator 在 change 后调 sanitizeV2。
// CONFLICT 错误（revision 不匹配）由 Coordinator 抛出，Application 层直接传播。
// 纯 Application 层——仅 import domain/* + protocol/* + 同层 application/*。
import type { UserDataRepository } from '../ports/storage.js';
import type { Clock } from '../ports/clock.js';
import { normalizeStockCode } from '../../domain/stock.js';
import type { Stock } from '../../domain/stock.js';
import type { Group } from '../../domain/group.js';
import type { BoardConfig } from '../../domain/board-config.js';
import type { GroupId } from '../../domain/brands.js';
import type { AppError } from '../../domain/errors.js';
import type {
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
  MutationResult
} from '../../protocol/messages.js';

/** 固定计算视图分组 ID。 */
const ALL_GROUP_ID = 'g_all' as GroupId;

/** 分组上限（1 个默认 + 19 个自定义）。 */
const MAX_GROUPS = 20;

/** 默认看板配置：无 boardConfig 时创建。 */
const DEFAULT_BOARD_CONFIG: BoardConfig = {
  viewMode: 'list',
  sortField: 'manual',
  sortDirection: 'asc',
  priceHidden: false
};

/** 构造 VALIDATION_FAILED 错误。 */
function validationError(message: string): AppError {
  return { code: 'VALIDATION_FAILED', message, retryable: false };
}

/** 从只读记录中移除指定键，返回新的可变记录。 */
function omitKey<V>(record: Readonly<Record<string, V>>, omit: string): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== omit) out[key] = value;
  }
  return out;
}

/** PortfolioCommands 接口：10 个原子最终态写命令。 */
export interface PortfolioCommands {
  addStock(payload: AddStockPayload): Promise<MutationResult<Stock>>;
  removeStocks(payload: RemoveStockPayload): Promise<MutationResult<null>>;
  moveStocks(payload: MoveStockPayload): Promise<MutationResult<null>>;
  setPinned(payload: SetPinnedPayload): Promise<MutationResult<null>>;
  setOrder(payload: SetStockOrderPayload): Promise<MutationResult<null>>;
  createGroup(payload: CreateGroupPayload): Promise<MutationResult<Group>>;
  renameGroup(payload: RenameGroupPayload): Promise<MutationResult<null>>;
  deleteGroup(payload: DeleteGroupPayload): Promise<MutationResult<null>>;
  setGroupOrder(payload: SetGroupOrderPayload): Promise<MutationResult<null>>;
  patchPreferences(payload: PatchPreferencesPayload): Promise<MutationResult<BoardConfig>>;
}

/**
 * PortfolioCommands 实现：每个方法调 storage.mutate() 恰好一次。
 *
 * 事务规则：
 * - addStock：normalizeStockCode 校验；已存在则合并 groupIds（并集）+ 补 name（仅当空）；否则 push 新 Stock。
 * - removeStocks：g_all 完全移除（Coordinator 清理 quoteCache）；自定义组仅移除 membership + 该组 manualOrder/pinned。
 * - moveStocks：从 fromGroupId 移除 membership（若非 g_all），添加 targetGroupIds（去重、过滤 g_all）。
 * - setPinned：设 pinned[groupId] + 用 orderedCodes 写所有 manualOrder[groupId] 索引。
 * - setOrder：用 orderedCodes 写 manualOrder[groupId] + 设 boardConfig[groupId].sortField='manual'。
 * - createGroup：用调用方 groupId；上限 20 检查。
 * - renameGroup：设 name + updatedAt。
 * - deleteGroup：移除分组 + 清理所有 stock 的 groupIds/manualOrder/pinned + 删 boardConfig 键；不得删 g_all。
 * - setGroupOrder：按 orderedGroupIds 重排 order。
 * - patchPreferences：boardConfig[groupId] 合并 patch（白名单字段由协议校验器保证）。
 */
export class PortfolioCommandsImpl implements PortfolioCommands {
  constructor(
    private readonly storage: Pick<UserDataRepository, 'mutate'>,
    private readonly clock: Clock
  ) {}

  addStock(payload: AddStockPayload): Promise<MutationResult<Stock>> {
    return this.storage.mutate(payload.expectedRevision, (draft) => {
      const normalized = normalizeStockCode(payload.code);
      if (!normalized) {
        throw validationError(`invalid stock code: ${payload.code}`);
      }
      const cleanGroupIds = [...new Set(payload.groupIds.filter((id) => id !== ALL_GROUP_ID))];
      const index = draft.watchlist.findIndex((s) => s.code === normalized);
      if (index >= 0) {
        // 合并：groupIds 并集 + name 仅当 existing 为空时补充
        const existing = draft.watchlist[index];
        const updated: Stock = {
          code: existing.code,
          name: existing.name || payload.name,
          groupIds: [...new Set([...existing.groupIds, ...cleanGroupIds])],
          manualOrder: existing.manualOrder,
          pinned: existing.pinned,
          addedAt: existing.addedAt
        };
        draft.watchlist[index] = updated;
        return updated;
      }
      const stock: Stock = {
        code: normalized,
        name: payload.name,
        groupIds: cleanGroupIds,
        manualOrder: {},
        pinned: {},
        addedAt: this.clock.now()
      };
      draft.watchlist.push(stock);
      return stock;
    });
  }

  removeStocks(payload: RemoveStockPayload): Promise<MutationResult<null>> {
    return this.storage.mutate(payload.expectedRevision, (draft) => {
      const codesToRemove = new Set(payload.codes);
      if (payload.groupId === ALL_GROUP_ID) {
        // 全局移除：从 watchlist 完全删除（Coordinator 清理 quoteCache）
        draft.watchlist = draft.watchlist.filter((s) => !codesToRemove.has(s.code));
      } else {
        // 自定义组：仅移除该组 membership + 清理该组 manualOrder/pinned
        for (let i = 0; i < draft.watchlist.length; i++) {
          const stock = draft.watchlist[i];
          if (!codesToRemove.has(stock.code)) continue;
          draft.watchlist[i] = {
            code: stock.code,
            name: stock.name,
            groupIds: stock.groupIds.filter((id) => id !== payload.groupId),
            manualOrder: omitKey(stock.manualOrder, payload.groupId),
            pinned: omitKey(stock.pinned, payload.groupId),
            addedAt: stock.addedAt
          };
        }
      }
      return null;
    });
  }

  moveStocks(payload: MoveStockPayload): Promise<MutationResult<null>> {
    return this.storage.mutate(payload.expectedRevision, (draft) => {
      const codesToMove = new Set(payload.codes);
      const targetIds = [...new Set(payload.targetGroupIds.filter((id) => id !== ALL_GROUP_ID))];
      for (let i = 0; i < draft.watchlist.length; i++) {
        const stock = draft.watchlist[i];
        if (!codesToMove.has(stock.code)) continue;
        // 从 fromGroupId 移除（若非 g_all），添加 targetGroupIds（去重）
        const baseGroupIds = payload.fromGroupId === ALL_GROUP_ID
          ? [...stock.groupIds]
          : stock.groupIds.filter((id) => id !== payload.fromGroupId);
        draft.watchlist[i] = {
          code: stock.code,
          name: stock.name,
          groupIds: [...new Set([...baseGroupIds, ...targetIds])],
          manualOrder: stock.manualOrder,
          pinned: stock.pinned,
          addedAt: stock.addedAt
        };
      }
      return null;
    });
  }

  setPinned(payload: SetPinnedPayload): Promise<MutationResult<null>> {
    return this.storage.mutate(payload.expectedRevision, (draft) => {
      // 计算当前可见 code 集：g_all 时为全部 stock，自定义组时为该组成员
      const visibleCodes = new Set(
        payload.groupId === ALL_GROUP_ID
          ? draft.watchlist.map((s) => s.code)
          : draft.watchlist
              .filter((s) => s.groupIds.includes(payload.groupId))
              .map((s) => s.code)
      );
      // 精确匹配校验：大小相同 + 每个元素互含
      const orderedSet = new Set(payload.orderedCodes);
      if (
        orderedSet.size !== visibleCodes.size ||
        ![...visibleCodes].every((c) => orderedSet.has(c))
      ) {
        throw validationError('orderedCodes must be exactly the current visible code set');
      }
      for (let i = 0; i < draft.watchlist.length; i++) {
        const stock = draft.watchlist[i];
        const orderIndex = payload.orderedCodes.indexOf(stock.code);
        if (orderIndex < 0) continue;
        // 对 orderedCodes 中的每个 stock：写 manualOrder[groupId] = index
        // 对指定 code：同时写 pinned[groupId] = pinned
        const newPinned = stock.code === payload.code
          ? { ...stock.pinned, [payload.groupId]: payload.pinned }
          : stock.pinned;
        draft.watchlist[i] = {
          code: stock.code,
          name: stock.name,
          groupIds: stock.groupIds,
          manualOrder: { ...stock.manualOrder, [payload.groupId]: orderIndex },
          pinned: newPinned,
          addedAt: stock.addedAt
        };
      }
      return null;
    });
  }

  setOrder(payload: SetStockOrderPayload): Promise<MutationResult<null>> {
    return this.storage.mutate(payload.expectedRevision, (draft) => {
      // 写 manualOrder[groupId] = index for each orderedCode
      for (let i = 0; i < draft.watchlist.length; i++) {
        const stock = draft.watchlist[i];
        const orderIndex = payload.orderedCodes.indexOf(stock.code);
        if (orderIndex < 0) continue;
        draft.watchlist[i] = {
          code: stock.code,
          name: stock.name,
          groupIds: stock.groupIds,
          manualOrder: { ...stock.manualOrder, [payload.groupId]: orderIndex },
          pinned: stock.pinned,
          addedAt: stock.addedAt
        };
      }
      // 同时设 boardConfig[groupId].sortField = 'manual'
      const existing = draft.boardConfig[payload.groupId] ?? DEFAULT_BOARD_CONFIG;
      draft.boardConfig = {
        ...draft.boardConfig,
        [payload.groupId]: { ...existing, sortField: 'manual' }
      };
      return null;
    });
  }

  createGroup(payload: CreateGroupPayload): Promise<MutationResult<Group>> {
    return this.storage.mutate(payload.expectedRevision, (draft) => {
      if (draft.groups.length >= MAX_GROUPS) {
        throw validationError(`group limit reached (max ${MAX_GROUPS})`);
      }
      const now = this.clock.now();
      const group: Group = {
        groupId: payload.groupId,
        name: payload.name,
        order: draft.groups.length,
        isDefault: false,
        createdAt: now,
        updatedAt: now
      };
      draft.groups.push(group);
      return group;
    });
  }

  renameGroup(payload: RenameGroupPayload): Promise<MutationResult<null>> {
    return this.storage.mutate(payload.expectedRevision, (draft) => {
      for (let i = 0; i < draft.groups.length; i++) {
        if (draft.groups[i].groupId === payload.groupId) {
          const existing = draft.groups[i];
          draft.groups[i] = {
            groupId: existing.groupId,
            name: payload.name,
            order: existing.order,
            isDefault: existing.isDefault,
            createdAt: existing.createdAt,
            updatedAt: this.clock.now()
          };
          break;
        }
      }
      return null;
    });
  }

  deleteGroup(payload: DeleteGroupPayload): Promise<MutationResult<null>> {
    return this.storage.mutate(payload.expectedRevision, (draft) => {
      if (payload.groupId === ALL_GROUP_ID) {
        throw validationError('cannot delete the default group g_all');
      }
      // 从 groups 移除
      draft.groups = draft.groups.filter((g) => g.groupId !== payload.groupId);
      // 从每个 stock 的 groupIds/manualOrder/pinned 移除该 groupId
      for (let i = 0; i < draft.watchlist.length; i++) {
        const stock = draft.watchlist[i];
        const hasMeta =
          stock.groupIds.includes(payload.groupId) ||
          payload.groupId in stock.manualOrder ||
          payload.groupId in stock.pinned;
        if (!hasMeta) continue;
        draft.watchlist[i] = {
          code: stock.code,
          name: stock.name,
          groupIds: stock.groupIds.filter((id) => id !== payload.groupId),
          manualOrder: omitKey(stock.manualOrder, payload.groupId),
          pinned: omitKey(stock.pinned, payload.groupId),
          addedAt: stock.addedAt
        };
      }
      // 从 boardConfig 删除该 groupId 键
      draft.boardConfig = omitKey(draft.boardConfig, payload.groupId) as Record<GroupId, BoardConfig>;
      return null;
    });
  }

  setGroupOrder(payload: SetGroupOrderPayload): Promise<MutationResult<null>> {
    return this.storage.mutate(payload.expectedRevision, (draft) => {
      // 物理重排 groups 数组——sanitizeV2 按数组位置分配 order（index+1）。
      const orderedSet = new Set(payload.orderedGroupIds);
      const groupMap = new Map(draft.groups.map((g) => [g.groupId, g]));
      const reordered: Group[] = [];
      for (const id of payload.orderedGroupIds) {
        const group = groupMap.get(id);
        if (group) reordered.push(group);
      }
      // 保留 orderedGroupIds 中未列出的分组（追加到末尾）
      for (const group of draft.groups) {
        if (!orderedSet.has(group.groupId)) reordered.push(group);
      }
      draft.groups = reordered;
      return null;
    });
  }

  patchPreferences(payload: PatchPreferencesPayload): Promise<MutationResult<BoardConfig>> {
    return this.storage.mutate(payload.expectedRevision, (draft) => {
      const existing = draft.boardConfig[payload.groupId] ?? DEFAULT_BOARD_CONFIG;
      const merged: BoardConfig = { ...existing, ...payload.patch };
      draft.boardConfig = {
        ...draft.boardConfig,
        [payload.groupId]: merged
      };
      return merged;
    });
  }
}
