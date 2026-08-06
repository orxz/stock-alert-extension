// src/infrastructure/storage/migration-service.ts
// schema v0/v1 → v2 迁移：幂等、保留首次备份。
// 语义精确移植自 v1.3 storage.js migrateToV2（第 57–90 行）。
import type { StorageArea } from './storage-area.js';
import type { UserData } from '../../domain/board-config.js';
import {
  sanitizeV2,
  SCHEMA_VERSION,
  MIGRATION_BACKUP_KEY,
  DEFAULT_GROUP_ID
} from './sanitize-v2.js';

/**
 * 将 raw 存储记录迁移到 schema v2（幂等）。
 *
 * 1. 若无 MIGRATION_BACKUP_KEY，写入备份（首次备份不覆盖）。
 * 2. v0 扁平列表：若 raw.watchlist 不存在但 raw.watchlist_legacy 是数组，
 *    从 legacy 还原——每项 {code, name:name||code, groupIds:['g_all'],
 *    manualOrder:{}, pinned:{}, addedAt:addedAt||now-index*1000}。
 * 3. sanitizeV2({ ...source, schemaVersion:2 }, now) 后 area.set(migrated) 持久化。
 *
 * @param area  存储区域（用于写入备份和迁移结果）
 * @param raw   从 area.get() 读取的原始记录
 * @param now   当前时间戳（确定性测试时由 clock 传入）
 */
export async function migrateToV2(
  area: StorageArea,
  raw: Record<string, unknown>,
  now: number
): Promise<UserData> {
  // 1. 首次备份（不覆盖已有备份）
  if (!raw[MIGRATION_BACKUP_KEY]) {
    await area.set({
      [MIGRATION_BACKUP_KEY]: {
        savedAt: now,
        groups: raw.groups ?? null,
        watchlist: raw.watchlist ?? null,
        boardConfig: raw.boardConfig ?? null,
        watchlist_legacy: raw.watchlist_legacy ?? null
      }
    });
  }

  // 2. v0 扁平列表：无 watchlist 时先从 watchlist_legacy 还原
  let source: Record<string, unknown> = raw;
  if (!raw.watchlist && Array.isArray(raw.watchlist_legacy)) {
    source = {
      ...raw,
      watchlist: (raw.watchlist_legacy as unknown[]).map((item, index) => {
        const entry: Record<string, unknown> =
          typeof item === 'string' ? { code: item } : (item as Record<string, unknown>);
        return {
          code: entry.code,
          name: entry.name || entry.code,
          groupIds: [DEFAULT_GROUP_ID], // sanitizeV2 会移除 g_all
          manualOrder: {},
          pinned: {},
          addedAt: entry.addedAt || now - index * 1000
        };
      })
    };
  }

  // 3. sanitizeV2 清洗 + 持久化
  const migrated = sanitizeV2({ ...source, schemaVersion: SCHEMA_VERSION }, now);
  await area.set({
    schemaVersion: migrated.schemaVersion,
    groups: migrated.groups,
    watchlist: migrated.watchlist,
    boardConfig: migrated.boardConfig
  });
  return migrated;
}
