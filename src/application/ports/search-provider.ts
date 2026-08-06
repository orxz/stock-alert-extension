// src/application/ports/search-provider.ts
// 股票搜索 Provider 端口：Application 层通过此接口执行远端股票搜索。
// 纯接口——只 import domain，不依赖 infrastructure/fetch/Chrome。
// 具体实现（EastmoneySearchProvider）在 infrastructure 层。
import type { StockSearchResult } from '../../domain/quote.js';
import type { CancellationToken } from './cancellation.js';

/**
 * 股票搜索 Provider 端口：按关键词搜索 A 股股票。
 * - search(): 接收搜索关键词与取消令牌，返回 StockSearchResult 列表。
 *
 * 实现约束：
 * - 接收注入的 fetch（构造器参数），不直接引用 globalThis.fetch。
 * - 通过 CancellationToken 桥接到 AbortController，传播取消到底层 HTTP 请求。
 * - 空 query 返回空数组（由上层 SearchService 处理，Provider 可假定非空）。
 */
export interface StockSearchProvider {
  search(
    query: string,
    cancellation: CancellationToken
  ): Promise<readonly StockSearchResult[]>;
}
