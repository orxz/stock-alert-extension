// src/application/search/search-service.ts
// SearchService：股票搜索用例——远端搜索 + 本地降级 + 4s 超时取消。
// 纯 Application 层——仅 import domain/* + protocol/* + 同层 application/*。
// 远端搜索失败且非 abort 时降级到注入的本地搜索函数（composition root 负责注入 searchLocalCatalog）。
// Brief Step 5 逐字逻辑：searchStocks 的 try/catch/abort 检查 + SearchService 的 CancellationSource/Clock/finally。
import type { StockSearchResult } from '../../domain/quote.js';
import type { StockSearchProvider } from '../ports/search-provider.js';
import type { Clock } from '../ports/clock.js';
import type { CancellationToken } from '../ports/cancellation.js';
import { createCancellationSource } from '../ports/cancellation.js';

/** 本地搜索函数签名（由 composition root 注入 searchLocalCatalog）。 */
export type LocalSearchFn = (query: string) => readonly StockSearchResult[];

/** 搜索超时时间（毫秒）。 */
const SEARCH_TIMEOUT_MS = 4000;

/** 本地降级最大返回数。 */
const LOCAL_FALLBACK_LIMIT = 20;

/**
 * 股票搜索服务：远端优先，失败降级本地。
 *
 * 生命周期：
 * 1. search(query) 创建 CancellationSource
 * 2. 通过 Clock.schedule 调度 4s 超时取消
 * 3. 调用 searchStocks(query, token)
 * 4. finally 取消计时器
 *
 * searchStocks 降级规则（Brief Step 5 逐字）：
 * - 空 query → []
 * - remote 成功 → remote 结果
 * - remote 失败且 token 已 abort → 重新抛出（不降级）
 * - remote 失败且非 abort → 降级 localCatalog.slice(0, 20)
 */
export class SearchService {
  constructor(
    private readonly remote: StockSearchProvider,
    private readonly localSearch: LocalSearchFn,
    private readonly clock: Clock
  ) {}

  /**
   * 搜索入口：创建取消源 + 超时计时器，调用 searchStocks，finally 清理。
   * Task 10 的 Background handler 通过此方法处理 StockSearch RPC。
   */
  async search(query: string): Promise<readonly StockSearchResult[]> {
    const source = createCancellationSource();
    const timer = this.clock.schedule(SEARCH_TIMEOUT_MS, () => source.cancel());
    try {
      return await this.searchStocks(query, source.token);
    } finally {
      timer.cancel();
    }
  }

  /**
   * 搜索核心逻辑（Brief Step 5 逐字）：
   * - trim + 空检查
   * - remote.search → 成功返回
   * - catch: abort → rethrow; 否则降级 localSearch.slice(0, 20)
   */
  private async searchStocks(
    query: string,
    cancellation: CancellationToken
  ): Promise<readonly StockSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    try {
      return await this.remote.search(normalized, cancellation);
    } catch (error) {
      if (cancellation.aborted) throw error;
      return this.localSearch(normalized).slice(0, LOCAL_FALLBACK_LIMIT);
    }
  }
}
