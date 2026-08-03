// src/infrastructure/quote-providers/eastmoney-search-provider.ts
// EastmoneySearchProvider：东方财富股票搜索传输适配器。
// 构造器接收注入的 fetch，通过 CancellationToken 桥接到 AbortController。
// endpoint / params / SecurityType 过滤 / 前缀映射均从 v1.3 quotes.js searchStocks 移植。
import type { StockSearchResult } from '../../domain/quote.js';
import type { StockSearchProvider } from '../../application/ports/search-provider.js';
import type { CancellationToken } from '../../application/ports/cancellation.js';
import { parseEastmoneySearch } from './provider-parsers.js';

/** Eastmoney 搜索 endpoint。 */
const SEARCH_ENDPOINT = 'https://searchapi.eastmoney.com/api/suggest/get';

/** 东方财富搜索接口的公共客户端令牌（非密钥），与官网前端一致，可公开使用。 */
const SEARCH_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';

/** fetch 函数类型（与 globalThis.fetch 签名兼容）。 */
type FetchFn = typeof globalThis.fetch;

/**
 * 将 CancellationToken 桥接到 AbortController，返回 fetch init 中的 signal。
 * - 若 token 已取消，立即返回已 abort 的 signal。
 * - 否则注册 onCancel listener → controller.abort()。
 */
function linkCancellation(token: CancellationToken): { signal?: AbortSignal } {
  if (typeof AbortController === 'undefined') return {};
  const controller = new AbortController();
  token.onCancel(() => controller.abort());
  return { signal: controller.signal };
}

/**
 * 东方财富搜索 Provider 实现。
 * 通过注入的 fetch 调用 Eastmoney 搜索接口，返回 parseEastmoneySearch 规范化的 StockSearchResult 列表。
 */
export class EastmoneySearchProvider implements StockSearchProvider {
  constructor(private readonly fetchFn: FetchFn) {}

  async search(
    query: string,
    cancellation: CancellationToken
  ): Promise<readonly StockSearchResult[]> {
    const params = new URLSearchParams({
      input: query,
      type: '14',
      token: SEARCH_TOKEN,
      count: '15'
    });
    const url = `${SEARCH_ENDPOINT}?${params.toString()}`;
    const init = linkCancellation(cancellation);
    const response = await this.fetchFn(url, { method: 'GET', ...init });
    if (!response.ok) {
      throw new Error(`search HTTP ${response.status}`);
    }
    const json = await response.json();
    return parseEastmoneySearch(json);
  }
}
