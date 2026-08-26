// src/infrastructure/quote-providers/eastmoney-chart-provider.ts
// EastmoneyChartProvider：东方财富历史行情（分时/K线）传输适配器（v2.2）。
// 端点 push2his.eastmoney.com（与主行情域 push2 不同子域，manifest host_permissions 需含）。
// 构造器接收注入的 fetch，通过 CancellationToken 桥接到 AbortController。
// 纯传输层：只负责 URL 构造 + fetch + 委托 parseTrends / parseKline 解析。
//
// 字段实证（f51/f52 教训）：trends2/kline 的字段语义已用真实响应核对，
// 样本与推断记录在 parseTrends / parseKline 的注释中——不许照字段表抄。
import type { StockCode } from '../../domain/brands.js';
import type { ChartKind, KlinePeriod, TrendPoint, KlineBar } from '../../domain/chart.js';
import type { CancellationToken } from '../../application/ports/cancellation.js';
import { parseEastmoneyTrends, parseEastmoneyKline } from './provider-parsers.js';

/** Provider 返回的领域形状（图表服务直接消费）。 */
export interface TrendsPayload {
  readonly code: StockCode;
  readonly name: string;
  readonly prevClose?: number;
  readonly points: readonly TrendPoint[];
}

export interface KlinePayload {
  readonly code: StockCode;
  readonly name: string;
  readonly bars: readonly KlineBar[];
}

/** 东财历史行情端点（分时 + K线）。 */
const HISTORY_ENDPOINT = 'https://push2his.eastmoney.com/api/qt/stock/trends2/get';

/** 东财 K线端点。 */
const KLINE_ENDPOINT = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

type FetchFn = typeof globalThis.fetch;

/** 行情字段（与主源的报价字段同名同义，这里不重复声明——直接请求固定字段集）。 */
const TRENDS_FIELDS1 = 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13';
const TRENDS_FIELDS2 = 'f51,f52,f53,f54,f55,f56,f57,f58';

/** K线周期 → 东财 klt（101 日 / 102 周 / 103 月）。 */
const KLT_BY_PERIOD: Readonly<Record<KlinePeriod, string>> = {
  day: '101',
  week: '102',
  month: '103'
};

/** 将规范化的 StockCode 转为 Eastmoney secid（与主源 toSecids 同映射，指数同样适用）。 */
function toSecid(code: StockCode): string {
  const lower = code.toLowerCase();
  const number = lower.replace(/^(sh|sz|bj)/, '');
  if (lower.startsWith('bj')) return '0.' + number;
  if (lower.startsWith('sh')) return '1.' + number;
  return '0.' + number;
}

/** 将 CancellationToken 桥接到 AbortController。 */
function linkCancellation(token: CancellationToken): { signal?: AbortSignal } {
  if (typeof AbortController === 'undefined') return {};
  const controller = new AbortController();
  token.onCancel(() => controller.abort());
  return { signal: controller.signal };
}

/**
 * 东方财富历史行情 Provider。
 * - fetchTrends(code)：当日分时（trends2，ndays=1）。
 * - fetchKline(code, period)：日/周/月 K（kline/get，lmt=250 供均线与翻页余量）。
 */
export class EastmoneyChartProvider {
  constructor(private readonly fetchFn: FetchFn) {}

  async fetchTrends(code: StockCode, cancellation: CancellationToken): Promise<TrendsPayload> {
    const params = new URLSearchParams({
      secid: toSecid(code),
      fields1: TRENDS_FIELDS1,
      fields2: TRENDS_FIELDS2,
      ndays: '1',
      iscr: '0'
    });
    const url = `${HISTORY_ENDPOINT}?${params.toString()}`;
    const response = await this.fetchFn(url, { method: 'GET', ...linkCancellation(cancellation) });
    if (!response.ok) throw new Error(`eastmoney-chart HTTP ${response.status}`);
    const json = (await response.json()) as {
      data?: { name?: unknown; prePrice?: unknown; trends?: unknown };
    };
    return {
      code,
      name: String(json?.data?.name ?? code),
      prevClose: typeof json?.data?.prePrice === 'number' ? json.data.prePrice : undefined,
      points: parseEastmoneyTrends(json)
    };
  }

  async fetchKline(
    code: StockCode,
    period: KlinePeriod,
    cancellation: CancellationToken
  ): Promise<KlinePayload> {
    const params = new URLSearchParams({
      secid: toSecid(code),
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      klt: KLT_BY_PERIOD[period],
      fqt: '1',
      end: '20500101',
      lmt: '250'
    });
    const url = `${KLINE_ENDPOINT}?${params.toString()}`;
    const response = await this.fetchFn(url, { method: 'GET', ...linkCancellation(cancellation) });
    if (!response.ok) throw new Error(`eastmoney-chart HTTP ${response.status}`);
    const json = (await response.json()) as {
      data?: { name?: unknown; prePrice?: unknown; klines?: unknown };
    };
    return {
      code,
      name: String(json?.data?.name ?? code),
      bars: parseEastmoneyKline(json)
    };
  }

  /** 按形态分发：ChartService 只需一个统一的 fetch 入口。 */
  async fetch(
    code: StockCode,
    kind: ChartKind,
    period: KlinePeriod,
    cancellation: CancellationToken
  ): Promise<TrendsPayload | KlinePayload> {
    return kind === 'trends'
      ? this.fetchTrends(code, cancellation)
      : this.fetchKline(code, period, cancellation);
  }
}
