// src/infrastructure/quote-providers/tencent-quote-provider.ts
// TencentQuoteProvider：腾讯行情传输适配器（备源）。
// 构造器接收注入的 fetch，通过 CancellationToken 桥接到 AbortController。
//
// 选型说明（v2.0.1）：原备源 hq.sinajs.cn 自 2022 起强制校验 Referer，
// 而 Referer 属于 fetch forbidden header，MV3 Service Worker 无法设置
// （注入需 declarativeNetRequest 权限，与「不新增权限」冲突）——
// 实测扩展内固定返回 403，双源降级形同虚设。腾讯 qt.gtimg.cn 无此限制，
// 实测 4/4 成功、~0.5s，故替换为备源。
import type { StockCode } from '../../domain/brands.js';
import type { Quote } from '../../domain/quote.js';
import type { QuoteProvider } from '../../application/ports/quote-provider.js';
import type { CancellationToken } from '../../application/ports/cancellation.js';
import { parseTencent } from './provider-parsers.js';

/** 腾讯行情 endpoint（代码自带市场前缀，逗号分隔）。 */
const TENCENT_ENDPOINT = 'https://qt.gtimg.cn/q=';

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
 * 腾讯行情 Provider 实现。
 * 通过注入的 fetch 调用腾讯行情接口，GBK 解码后用 parseTencent 规范化为 Quote 映射。
 */
export class TencentQuoteProvider implements QuoteProvider {
  readonly name = 'tencent' as const;

  constructor(private readonly fetchFn: FetchFn) {}

  async fetch(
    codes: readonly StockCode[],
    cancellation: CancellationToken
  ): Promise<Readonly<Record<StockCode, Quote>>> {
    if (codes.length === 0) return {};
    const url = TENCENT_ENDPOINT + codes.join(',');
    const init = linkCancellation(cancellation);
    const response = await this.fetchFn(url, { method: 'GET', ...init });
    if (!response.ok) {
      throw new Error(`tencent HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buffer);
    return parseTencent(text);
  }
}
