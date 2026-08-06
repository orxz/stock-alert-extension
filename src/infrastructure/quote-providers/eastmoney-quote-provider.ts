// src/infrastructure/quote-providers/eastmoney-quote-provider.ts
// EastmoneyQuoteProvider：东方财富行情传输适配器。
// 构造器接收注入的 fetch（typeof globalThis.fetch），通过 CancellationToken 桥接到 AbortController。
// endpoint / params / secids 映射 / 价格缩放均从 v1.3 quotes.js fetchEastmoney 移植。
import type { StockCode } from '../../domain/brands.js';
import type { Quote } from '../../domain/quote.js';
import type { QuoteProvider } from '../../application/ports/quote-provider.js';
import type { CancellationToken } from '../../application/ports/cancellation.js';
import { parseEastmoney } from './provider-parsers.js';

/** Eastmoney 行情 endpoint。 */
const EASTMONEY_ENDPOINT = 'https://push2.eastmoney.com/api/qt/ulist.np/get';

/**
 * 公开行情字段列表（f2=现价 f3=涨跌幅 f4=涨跌额 f5=成交量 f6=成交额 f7=振幅 f8=换手率
 * f9=市盈率 f10=量比 f12=代码 f13=市场 f14=名称 f15=高 f16=低 f17=开 f18=昨收
 * f20=总市值 f21=流通市值 f23=市净率）。
 *
 * 不含涨停/跌停：该 endpoint 上 f51/f52 并非涨跌停价（实测 sh600519 返回 2715 亿、
 * sz000001 返回 0），f1–f300 全量扫描也无真实涨跌停字段。详见 parseEastmoney。
 */
const EASTMONEY_FIELDS = 'f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23';

/** fetch 函数类型（与 globalThis.fetch 签名兼容）。 */
type FetchFn = typeof globalThis.fetch;

/**
 * 将规范化的 StockCode 列表转为 Eastmoney secids 参数。
 * secids 映射（与 v1.3 _toSecids 一致）：
 * - bj → `0.`+number
 * - sh → `1.`+number
 * - sz（默认）→ `0.`+number
 */
function toSecids(codes: readonly StockCode[]): string[] {
  return codes.map((code) => {
    const lower = code.toLowerCase();
    const number = lower.replace(/^(sh|sz|bj)/, '');
    if (lower.startsWith('bj')) return '0.' + number;
    if (lower.startsWith('sh')) return '1.' + number;
    return '0.' + number;
  });
}

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
 * 东方财富行情 Provider 实现。
 * 通过注入的 fetch 调用 Eastmoney 行情接口，返回 parseEastmoney 规范化的 Quote 映射。
 */
export class EastmoneyQuoteProvider implements QuoteProvider {
  readonly name = 'eastmoney' as const;

  constructor(private readonly fetchFn: FetchFn) {}

  async fetch(
    codes: readonly StockCode[],
    cancellation: CancellationToken
  ): Promise<Readonly<Record<StockCode, Quote>>> {
    if (codes.length === 0) return {};
    const params = new URLSearchParams({
      fltt: '2',
      fields: EASTMONEY_FIELDS,
      secids: toSecids(codes).join(',')
    });
    const url = `${EASTMONEY_ENDPOINT}?${params.toString()}`;
    const init = linkCancellation(cancellation);
    const response = await this.fetchFn(url, { method: 'GET', ...init });
    if (!response.ok) {
      throw new Error(`eastmoney HTTP ${response.status}`);
    }
    const json = await response.json();
    return parseEastmoney(json);
  }
}
