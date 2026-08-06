// src/application/ports/storage.ts
// 存储端口接口：Application 层通过这些接口访问用户数据与行情缓存。
// 纯接口——只 import domain/protocol，不依赖 infrastructure。
// 具体实现（StorageCoordinator + 薄包装 Repository）在 infrastructure 层。
import type { GroupId, StockCode, UserDataRevision } from '../../domain/brands.js';
import type { Group } from '../../domain/group.js';
import type { Stock } from '../../domain/stock.js';
import type { BoardConfig, UserData } from '../../domain/board-config.js';
import type { QuoteCacheEntry } from '../../domain/quote.js';
import type { MutationResult } from '../../protocol/messages.js';

/**
 * Bootstrap 快照：冷启动时一次性读取的完整存储状态。
 * - userData: 清洗后的用户数据（groups + watchlist + boardConfig）。
 * - revision: userData 的 SHA-256 内容摘要（乐观并发控制基线）。
 * - quoteCache: watchlist 中所有股票的行情缓存（批量读取）。
 */
export interface BootstrapStorageSnapshot {
  readonly userData: UserData;
  readonly revision: UserDataRevision;
  readonly quoteCache: Readonly<Record<StockCode, QuoteCacheEntry>>;
}

/**
 * 可变 UserData 草稿：mutate 回调接收的可变副本。
 * groups/watchlist 数组本身可变（push/pop/splice/赋值），但元素字段仍为 domain 只读类型。
 * 修改单只股票时需用整体替换：draft.watchlist[i] = { ...draft.watchlist[i], groupIds: [...] }。
 */
export type MutableUserData = {
  schemaVersion: 2;
  groups: Group[];
  watchlist: Stock[];
  boardConfig: Record<GroupId, BoardConfig>;
};

/**
 * 用户数据仓储端口：Application 层通过此接口读取与修改用户数据。
 * - readBootstrap(): 冷启动读取完整快照（userData + revision + quoteCache）。
 * - mutate(): 乐观并发控制的原子修改——传入期望 revision，回调修改草稿，返回新值+新 revision。
 */
export interface UserDataRepository {
  readBootstrap(): Promise<BootstrapStorageSnapshot>;
  mutate<T>(
    expectedRevision: UserDataRevision,
    change: (draft: MutableUserData) => T | Promise<T>
  ): Promise<MutationResult<T>>;
}

/**
 * 行情缓存仓储端口：Application 层通过此接口读写行情缓存。
 * 缓存键为 `quoteCache:<code>`，仅 watchlist 中的股票可写入（防孤儿）。
 */
export interface QuoteCacheRepository {
  read(codes: readonly StockCode[]): Promise<Readonly<Record<StockCode, QuoteCacheEntry>>>;
  write(entries: Readonly<Record<StockCode, QuoteCacheEntry>>): Promise<void>;
  delete(codes: readonly StockCode[]): Promise<void>;
}
