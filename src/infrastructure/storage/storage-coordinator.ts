// src/infrastructure/storage/storage-coordinator.ts
// StorageCoordinator：单一存储协调器，拥有 chrome.storage.local 的唯一读写队列与临界区。
// 其下 UserDataRepository 与 QuoteCacheRepository 是薄能力包装。
//
// 核心设计：
// - 单一 Promise tail 串行队列——所有 6 个操作通过 enqueue 排队执行，无并发读改写。
// - readBootstrap 持有读临界区：读 raw → 迁移（若需）→ sanitize → digest → 冻结 code 集 → 批量读 cache。
// - mutate 持有写临界区：重新读最新 → digest 比对 → CONFLICT 则不写 → clone draft → 回调 → sanitize → 写 → 清理孤儿 cache。
// - writeQuoteCache 写入前重新检查 code 是否仍在 watchlist（防孤儿）。
// - reconcileOrphanQuoteCache 扫描 quoteCache:* 键，删除不在 watchlist 中的。
import type { StorageArea } from './storage-area.js';
import { sanitizeV2, SCHEMA_VERSION, MIGRATION_BACKUP_KEY } from './sanitize-v2.js';
import { migrateToV2 } from './migration-service.js';
import { computeUserDataRevision } from './user-data-revision.js';
import type { UserData } from '../../domain/board-config.js';
import type { StockCode, UserDataRevision } from '../../domain/brands.js';
import type { QuoteCacheEntry } from '../../domain/quote.js';
import type { AppError } from '../../domain/errors.js';
import type { MutationResult } from '../../protocol/messages.js';
import type { BootstrapStorageSnapshot, MutableUserData } from '../../application/ports/storage.js';

/** 行情缓存键前缀。 */
const QUOTE_CACHE_PREFIX = 'quoteCache:';

/** 用户数据相关的存储键列表（读取时批量请求）。 */
const USER_DATA_KEYS = [
  'schemaVersion',
  'groups',
  'watchlist',
  'boardConfig',
  'watchlist_legacy',
  MIGRATION_BACKUP_KEY
] as const;

/** StorageCoordinator 构造参数。 */
export interface StorageCoordinatorOptions {
  readonly area: StorageArea;
  readonly clock?: () => number;
}

/**
 * 单一存储协调器：拥有唯一读写队列。
 *
 * 所有操作串行化在一个 Promise tail 上——读临界区跨迁移、清洗、摘要和缓存读取；
 * 写临界区跨重读、比对、克隆、回写和孤儿清理。单队列保证 delete-watchlist 与
 * late-writeQuoteCache 并发时缓存不会被孤立。
 */
export class StorageCoordinator {
  private readonly area: StorageArea;
  private readonly clock: () => number;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: StorageCoordinatorOptions) {
    this.area = options.area;
    this.clock = options.clock ?? (() => Date.now());
  }

  // ===== 单队列调度 =====

  /** 将 task 追加到串行 Promise 链尾部，返回 task 的结果 Promise。 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result as Promise<T>;
  }

  // ===== 用户数据读取（内部辅助） =====

  /** 读取 raw 存储记录并返回清洗后的 UserData（若需迁移则持久化迁移结果）。 */
  private async loadUserData(): Promise<UserData> {
    const now = this.clock();
    const raw = await this.area.get(USER_DATA_KEYS);
    if (raw.schemaVersion === SCHEMA_VERSION) {
      return sanitizeV2(raw, now);
    }
    return migrateToV2(this.area, raw, now);
  }

  // ===== 行情缓存读取（内部辅助） =====

  /** 批量读取行情缓存，校验每个条目的结构完整性。 */
  private async readCacheInternal(
    codes: readonly StockCode[]
  ): Promise<Record<StockCode, QuoteCacheEntry>> {
    const uniqueCodes = [...new Set(codes)];
    if (uniqueCodes.length === 0) return {} as Record<StockCode, QuoteCacheEntry>;
    const keys = uniqueCodes.map((code) => quoteCacheKey(code));
    const raw = await this.area.get(keys);
    const result: Record<string, QuoteCacheEntry> = {};
    for (const code of uniqueCodes) {
      const value = raw[quoteCacheKey(code)];
      if (isValidCacheEntry(value, code)) {
        result[code] = value;
      }
    }
    return result as Record<StockCode, QuoteCacheEntry>;
  }

  // ===== 公共 API（6 方法，全部走 enqueue 串行化）=====

  /**
   * 冷启动读取：用户数据 + revision + 行情缓存的完整快照。
   * 持有读临界区跨迁移、清洗、摘要和缓存批量读取。
   */
  readBootstrap(): Promise<BootstrapStorageSnapshot> {
    return this.enqueue(() => this.doReadBootstrap());
  }

  private async doReadBootstrap(): Promise<BootstrapStorageSnapshot> {
    const userData = await this.loadUserData();
    const revision = await computeUserDataRevision(userData);
    const codes = userData.watchlist.map((stock) => stock.code);
    const quoteCache = await this.readCacheInternal(codes);
    // 清理孤儿缓存（在 readBootstrap 中执行确保每次冷启动都清理）。
    await this.doReconcile().catch(() => {});
    return { userData, revision, quoteCache };
  }

  /**
   * 乐观并发控制的原子修改。
   * 重新读最新 userData → digest 比对 → 不匹配抛 AppError(CONFLICT) →
   * structuredClone 可变 draft → 执行 change(draft) → sanitizeV2 →
   * 计算 newRevision → 写 groups/watchlist/boardConfig →
   * 删除被移除 codes 的 quoteCache → 返回 { value, userData, revision }。
   */
  mutate<T>(
    expectedRevision: UserDataRevision,
    change: (draft: MutableUserData) => T | Promise<T>
  ): Promise<MutationResult<T>> {
    return this.enqueue(() => this.doMutate(expectedRevision, change));
  }

  private async doMutate<T>(
    expectedRevision: UserDataRevision,
    change: (draft: MutableUserData) => T | Promise<T>
  ): Promise<MutationResult<T>> {
    const before = await this.loadUserData();
    const currentRevision = await computeUserDataRevision(before);

    if (currentRevision !== expectedRevision) {
      const error: AppError = {
        code: 'CONFLICT',
        message: 'user data revision mismatch — another mutation preceded this request',
        retryable: true
      };
      throw error;
    }

    const draft = structuredClone(before) as unknown as MutableUserData;
    const value = await change(draft);
    const after = sanitizeV2(draft, this.clock());
    const newRevision = await computeUserDataRevision(after);

    await this.area.set({
      schemaVersion: SCHEMA_VERSION,
      groups: after.groups,
      watchlist: after.watchlist,
      boardConfig: after.boardConfig
    });

    // 删除被移除 codes 的行情缓存（防孤儿）
    const beforeCodes = new Set(before.watchlist.map((s) => s.code));
    const afterCodes = new Set(after.watchlist.map((s) => s.code));
    const removedKeys: string[] = [];
    for (const code of beforeCodes) {
      if (!afterCodes.has(code)) removedKeys.push(quoteCacheKey(code));
    }
    if (removedKeys.length > 0) {
      await this.area.remove(removedKeys);
    }

    return { value, userData: after, revision: newRevision };
  }

  /** 批量读取行情缓存（只读，走队列保证一致性快照）。 */
  readQuoteCache(
    codes: readonly StockCode[]
  ): Promise<Readonly<Record<StockCode, QuoteCacheEntry>>> {
    return this.enqueue(() => this.readCacheInternal(codes));
  }

  /**
   * 批量写入行情缓存。
   * 写入前重新检查 code 是否仍在 watchlist 中（防孤儿）。
   */
  writeQuoteCache(
    entries: Readonly<Record<StockCode, QuoteCacheEntry>>
  ): Promise<void> {
    return this.enqueue(() => this.doWriteQuoteCache(entries));
  }

  private async doWriteQuoteCache(
    entries: Readonly<Record<StockCode, QuoteCacheEntry>>
  ): Promise<void> {
    const data = await this.loadUserData();
    const memberCodes = new Set(data.watchlist.map((stock) => stock.code));
    const patch: Record<string, unknown> = {};
    for (const [code, entry] of Object.entries(entries)) {
      if (memberCodes.has(code as StockCode)) {
        patch[quoteCacheKey(code)] = { ...entry, cacheVersion: 1, code };
      }
    }
    if (Object.keys(patch).length > 0) {
      await this.area.set(patch);
    }
  }

  /** 批量删除行情缓存。 */
  deleteQuoteCache(codes: readonly StockCode[]): Promise<void> {
    return this.enqueue(() => this.doDeleteQuoteCache(codes));
  }

  private async doDeleteQuoteCache(codes: readonly StockCode[]): Promise<void> {
    const uniqueCodes = [...new Set(codes)];
    if (uniqueCodes.length === 0) return;
    const keys = uniqueCodes.map((code) => quoteCacheKey(code));
    await this.area.remove(keys);
  }

  /**
   * 扫描所有 quoteCache:* 键，删除不在当前 watchlist 中的。
   * @returns 删除的孤儿条目数量。
   */
  reconcileOrphanQuoteCache(): Promise<number> {
    return this.enqueue(() => this.doReconcile());
  }

  private async doReconcile(): Promise<number> {
    const data = await this.loadUserData();
    const memberCodes = new Set(data.watchlist.map((stock) => stock.code));
    const all = await this.area.get(null);
    const orphanKeys: string[] = [];
    for (const key of Object.keys(all)) {
      if (key.startsWith(QUOTE_CACHE_PREFIX)) {
        const code = key.slice(QUOTE_CACHE_PREFIX.length);
        if (!memberCodes.has(code as StockCode)) {
          orphanKeys.push(key);
        }
      }
    }
    if (orphanKeys.length > 0) {
      await this.area.remove(orphanKeys);
    }
    return orphanKeys.length;
  }
}

// ===== 内部辅助函数 =====

/** 构造行情缓存键：`quoteCache:<code>`。 */
function quoteCacheKey(code: string): string {
  return `${QUOTE_CACHE_PREFIX}${code}`;
}

/** 校验行情缓存条目的结构完整性。 */
function isValidCacheEntry(
  value: unknown,
  code: string
): value is QuoteCacheEntry {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as QuoteCacheEntry).cacheVersion === 1 &&
    (value as QuoteCacheEntry).code === code &&
    Number.isFinite((value as QuoteCacheEntry).fetchedAt) &&
    (value as QuoteCacheEntry).quote !== null &&
    typeof (value as QuoteCacheEntry).quote === 'object'
  );
}
