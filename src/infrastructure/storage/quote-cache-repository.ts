// src/infrastructure/storage/quote-cache-repository.ts
// QuoteCacheRepository 薄包装：接收 Coordinator，转调 read/write/delete。
// 不含队列、不持有 StorageArea——并发控制完全由 Coordinator 的单队列保证。
import type { StorageCoordinator } from './storage-coordinator.js';
import type { QuoteCacheRepository } from '../../application/ports/storage.js';
import type { StockCode } from '../../domain/brands.js';
import type { QuoteCacheEntry } from '../../domain/quote.js';

/**
 * 行情缓存仓储：QuoteCacheRepository 端口的具体实现。
 * 薄包装——read/write/delete 转调同一 Coordinator 实例。
 */
export class QuoteCacheRepositoryImpl implements QuoteCacheRepository {
  constructor(private readonly coordinator: StorageCoordinator) {}

  read(
    codes: readonly StockCode[]
  ): Promise<Readonly<Record<StockCode, QuoteCacheEntry>>> {
    return this.coordinator.readQuoteCache(codes);
  }

  write(
    entries: Readonly<Record<StockCode, QuoteCacheEntry>>
  ): Promise<void> {
    return this.coordinator.writeQuoteCache(entries);
  }

  delete(codes: readonly StockCode[]): Promise<void> {
    return this.coordinator.deleteQuoteCache(codes);
  }
}
