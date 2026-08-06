// src/domain/quote.ts
// 行情值对象、缓存条目、快照与纯规则。零副作用：时间通过参数传入。
import type { StockCode } from './brands.js';

/**
 * 单条行情：由 Provider 返回或从缓存读取。
 * name 可选——部分 Provider 响应可能不包含名称，由格式化层回退到 stock.name。
 */
export interface Quote {
  readonly code: StockCode;
  readonly name?: string;
  readonly price: number;
  readonly change: number;
  readonly changePercent: number;
  readonly amount: number;
  /** 今开（元）——部分 Provider 返回；缺失时 undefined。 */
  readonly open?: number;
  /** 当日最高（元）——部分 Provider 返回；缺失时 undefined。 */
  readonly high?: number;
  /** 当日最低（元）——部分 Provider 返回；缺失时 undefined。 */
  readonly low?: number;
  /** 昨收（元）——部分 Provider 返回；缺失时 undefined。 */
  readonly prevClose?: number;
  /** 成交量（手）——部分 Provider 返回；缺失时 undefined。 */
  readonly volume?: number;
  /** 换手率（%）——部分 Provider 返回；缺失时 undefined。 */
  readonly turnoverRate?: number;
  /** 振幅（%）——部分 Provider 返回；缺失时 undefined。 */
  readonly amplitude?: number;
  /** 量比——部分 Provider 返回；缺失时 undefined。 */
  readonly volumeRatio?: number;
  /** 市盈率（倍，动态）——部分 Provider 返回；缺失时 undefined。 */
  readonly pe?: number;
  /** 市净率（倍）——部分 Provider 返回；缺失时 undefined。 */
  readonly pb?: number;
  /** 总市值（元）——部分 Provider 返回（腾讯以亿上报，解析时统一为元）；缺失时 undefined。 */
  readonly totalMarketCap?: number;
  /** 流通市值（元）——部分 Provider 返回（腾讯以亿上报，解析时统一为元）；缺失时 undefined。 */
  readonly floatMarketCap?: number;
  /** 涨停价（元）——部分 Provider 返回；缺失时 undefined。 */
  readonly limitUp?: number;
  /** 跌停价（元）——部分 Provider 返回；缺失时 undefined。 */
  readonly limitDown?: number;
}

/** 当前在用的行情源标识（主源 / 备源）。 */
export type QuoteProviderName = 'eastmoney' | 'tencent';

/**
 * 缓存中可能出现的行情源标识。
 * `sina` 是 v2.0.0 及更早版本写入的历史值——备源已于 v2.0.1 换为腾讯
 * （新浪强制校验 Referer，MV3 无法设置，实测固定 403）。
 * 仍在此保留以便无损读取旧缓存与 v1.3 回滚数据；新写入不再产生该值。
 */
export type PersistedQuoteProviderName = QuoteProviderName | 'sina';

/** 行情缓存条目：持久化在 `quoteCache:<code>` 键下。 */
export interface QuoteCacheEntry {
  readonly cacheVersion: 1;
  readonly code: StockCode;
  readonly provider: PersistedQuoteProviderName;
  readonly fetchedAt: number;
  readonly quote: Quote;
}

/** 单只股票的行情结果：fresh / cached / missing 三态。 */
export interface QuoteResult {
  readonly code: StockCode;
  readonly status: 'fresh' | 'cached' | 'missing';
  readonly source: PersistedQuoteProviderName | 'cache' | 'none';
  readonly provider: PersistedQuoteProviderName | 'unknown' | null;
  readonly fetchedAt: number | null;
  readonly quote: Quote | null;
  readonly error: string | null;
}

/** 行情快照：一次刷新或缓存读取的完整结果。 */
export interface QuoteSnapshot {
  readonly results: Readonly<Record<StockCode, QuoteResult>>;
  readonly counts: Readonly<{ fresh: number; cached: number; missing: number }>;
  readonly attemptedAt: number;
  readonly succeededAt: number | null;
  readonly generation: number;
  readonly deferredUntil?: number;
}

/** 股票搜索结果：由远端搜索或本地热门降级产生。 */
export interface StockSearchResult {
  readonly code: StockCode;
  readonly name: string;
  readonly pinyin: string;
  readonly tags: readonly string[];
}

/**
 * 判定行情是否可用：价格为有限正数。
 * 零价或非有限价格视为不可用（与 v1.3 一致）。
 */
export function isUsableQuote(quote: Quote | null): quote is Quote {
  return quote !== null && Number.isFinite(quote.price) && quote.price > 0;
}

/**
 * 从缓存构造行情快照（纯函数）。
 * - fresh: 有效缓存且 age < freshnessMs（默认 30s）
 * - cached: 有效缓存且 age <= 7 天（604_800_000ms）
 * - missing: 无缓存 / 无效价格 / 超过 7 天
 */
export function snapshotFromCache(
  cache: Readonly<Record<StockCode, QuoteCacheEntry>>,
  codes: readonly StockCode[],
  now: number,
  freshnessMs = 30_000
): QuoteSnapshot {
  const results = {} as Record<StockCode, QuoteResult>;
  const counts = { fresh: 0, cached: 0, missing: 0 };
  for (const code of codes) {
    const entry = cache[code];
    const age = entry ? Math.max(0, now - entry.fetchedAt) : Number.POSITIVE_INFINITY;
    const status = entry && isUsableQuote(entry.quote) && age <= 604_800_000
      ? age < freshnessMs ? 'fresh' : 'cached'
      : 'missing';
    counts[status] += 1;
    results[code] = status === 'missing'
      ? { code, status, source: 'none', provider: null, fetchedAt: null, quote: null, error: 'unavailable' }
      : { code, status, source: status === 'fresh' ? entry.provider : 'cache', provider: entry.provider, fetchedAt: entry.fetchedAt, quote: entry.quote, error: null };
  }
  return { results, counts, attemptedAt: now, succeededAt: null, generation: 0 };
}
