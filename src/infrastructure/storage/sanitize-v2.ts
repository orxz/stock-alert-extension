// src/infrastructure/storage/sanitize-v2.ts
// schema v2 幂等清洗：将任意 raw 输入规范化为合法 UserData。
// 语义精确移植自 v1.3 storage.js sanitizeV2（第 93–153 行）。
// 纯函数——不调用 Date.now() / chrome / 副作用，now 由调用方传入。
import { normalizeStockCode } from '../../domain/stock.js';
import type { UserData } from '../../domain/board-config.js';

/** 当前 schema 版本。 */
export const SCHEMA_VERSION = 2 as const;

/** v1.2.1 迁移备份键（首次迁移时写入，不覆盖）。 */
export const MIGRATION_BACKUP_KEY = 'migrationBackup:v1.2.1' as const;

/** 默认分组 ID（计算视图，固定首位，不出现在任何 stock.groupIds 中）。 */
export const DEFAULT_GROUP_ID = 'g_all';

/** 默认分组名称。 */
export const DEFAULT_GROUP_NAME = '全部';

/** 分组上限（1 个默认 + 19 个自定义）。 */
export const MAX_GROUPS = 20;

/**
 * schema v2 幂等清洗（纯函数）。
 *
 * 1. 分组：找出 g_all 作为默认组固定首位（order:0, isDefault:true），
 *    缺失则创建默认；自定义组去重、最多 19 个、order 重排 1..19、
 *    createdAt/updatedAt 缺省补 now。保留未知字段（浅展开）。
 * 2. watchlist：normalizeStockCode 规范化 code、丢弃非法；
 *    groupIds 移除 g_all 且只保留 validGroupIds 中的；
 *    按 code 合并重复（groupIds 并集、name 首非空优先、
 *    manualOrder/pinned 用 {...normalized.X, ...existing.X}（existing 优先）、
 *    addedAt 取最小）。
 * 3. boardConfig：浅拷贝原对象（保留无关字段）。
 * 4. 返回 { schemaVersion:2, groups, watchlist, boardConfig }。
 */
export function sanitizeV2(raw: unknown, now: number): UserData {
  const source: Record<string, unknown> =
    raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  // ===== 分组 =====
  const sourceGroups: Record<string, unknown>[] = Array.isArray(source.groups)
    ? source.groups.filter(
        (g): g is Record<string, unknown> => g !== null && typeof g === 'object'
      )
    : [];
  const allIndex = sourceGroups.findIndex((g) => g.groupId === DEFAULT_GROUP_ID);
  const groups: Record<string, unknown>[] = [];

  if (allIndex >= 0) {
    const all = sourceGroups.splice(allIndex, 1)[0];
    groups.push({
      ...all,
      name: all.name || DEFAULT_GROUP_NAME,
      order: 0,
      isDefault: true,
      createdAt: all.createdAt ?? now,
      updatedAt: all.updatedAt ?? now
    });
  } else {
    groups.push({
      groupId: DEFAULT_GROUP_ID,
      name: DEFAULT_GROUP_NAME,
      order: 0,
      isDefault: true,
      createdAt: now,
      updatedAt: now
    });
  }

  const seenGroupIds = new Set<string>([DEFAULT_GROUP_ID]);
  sourceGroups
    .filter((g) => {
      if (typeof g.groupId !== 'string' || seenGroupIds.has(g.groupId)) return false;
      seenGroupIds.add(g.groupId);
      return true;
    })
    .slice(0, MAX_GROUPS - 1)
    .forEach((g, index) => {
      g.order = index + 1;
      g.createdAt = g.createdAt ?? now;
      g.updatedAt = g.updatedAt ?? now;
      groups.push(g);
    });
  const validGroupIds = new Set<string>(groups.map((g) => g.groupId as string));

  // ===== watchlist =====
  const byCode = new Map<string, Record<string, unknown>>();
  const sourceWatchlist = Array.isArray(source.watchlist) ? source.watchlist : [];
  for (const stock of sourceWatchlist) {
    if (stock === null || typeof stock !== 'object') continue;
    const s = stock as Record<string, unknown>;
    const code = normalizeStockCode(s.code);
    if (!code) continue;
    const customGroupIds: string[] = Array.isArray(s.groupIds)
      ? [
          ...new Set(
            (s.groupIds as unknown[])
              .filter((id) => id !== DEFAULT_GROUP_ID && validGroupIds.has(id as string))
              .map((id) => id as string)
          )
        ]
      : [];
    const normalized: Record<string, unknown> = {
      code,
      name: typeof s.name === 'string' ? s.name : '',
      groupIds: customGroupIds,
      manualOrder:
        s.manualOrder && typeof s.manualOrder === 'object'
          ? { ...(s.manualOrder as Record<string, unknown>) }
          : {},
      pinned:
        s.pinned && typeof s.pinned === 'object'
          ? { ...(s.pinned as Record<string, unknown>) }
          : {},
      addedAt: Number.isFinite(s.addedAt) ? (s.addedAt as number) : now
    };
    const existing = byCode.get(code);
    if (existing) {
      existing.groupIds = [
        ...new Set([
          ...(existing.groupIds as string[]),
          ...(normalized.groupIds as string[])
        ])
      ];
      if ((normalized.name as string) && !(existing.name as string)) {
        existing.name = normalized.name;
      }
      existing.manualOrder = {
        ...(normalized.manualOrder as Record<string, unknown>),
        ...(existing.manualOrder as Record<string, unknown>)
      };
      existing.pinned = {
        ...(normalized.pinned as Record<string, unknown>),
        ...(existing.pinned as Record<string, unknown>)
      };
      if ((normalized.addedAt as number) < (existing.addedAt as number)) {
        existing.addedAt = normalized.addedAt;
      }
    } else {
      byCode.set(code, normalized);
    }
  }
  const watchlist = [...byCode.values()];

  // ===== boardConfig =====
  const boardConfig =
    source.boardConfig !== null && typeof source.boardConfig === 'object'
      ? { ...(source.boardConfig as Record<string, unknown>) }
      : {};

  return {
    schemaVersion: SCHEMA_VERSION,
    groups,
    watchlist,
    boardConfig
  } as unknown as UserData;
}
