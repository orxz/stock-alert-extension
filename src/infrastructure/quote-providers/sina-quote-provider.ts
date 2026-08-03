// src/infrastructure/quote-providers/sina-quote-provider.ts
// SinaQuoteProvider：新浪行情传输适配器。
// 构造器接收注入的 fetch，通过 CancellationToken 桥接到 AbortController。
// endpoint / GBK 解码 / 逐行解析均从 v1.3 quotes.js fetchSina + parseSina 移植。
import type { StockCode } from '../../domain/brands.js';
import type { Quote } from '../../domain/quote.js';
import type { QuoteProvider } from '../../application/ports/quote-provider.js';
import type { CancellationToken } from '../../application/ports/cancellation.js';
import { parseSina } from './provider-parsers.js';

/** Sina 行情 endpoint。 */
const SINA_ENDPOINT = 'https://hq.sinajs.cn/list=';

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
 * 新浪行情 Provider 实现。
 * 通过注入的 fetch 调用 Sina 行情接口，GBK 解码后用 parseSina 规范化为 Quote 映射。
 */
export class SinaQuoteProvider implements QuoteProvider {
  readonly name = 'sina' as const;

  constructor(private readonly fetchFn: FetchFn) {}

  async fetch(
    codes: readonly StockCode[],
    cancellation: CancellationToken
  ): Promise<Readonly<Record<StockCode, Quote>>> {
    if (codes.length === 0) return {};
    const url = SINA_ENDPOINT + codes.join(',');
    const init = linkCancellation(cancellation);
    const response = await this.fetchFn(url, { method: 'GET', ...init });
    if (!response.ok) {
      throw new Error(`sina HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buffer);
    return parseSina(text);
  }
}
