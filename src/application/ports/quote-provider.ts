// src/application/ports/quote-provider.ts
// 行情 Provider 端口：Application 层通过此接口获取行情数据。
// 纯接口——只 import domain，不依赖 infrastructure/fetch/Chrome。
// 具体实现（EastmoneyQuoteProvider / TencentQuoteProvider）在 infrastructure 层。
import type { StockCode } from '../../domain/brands.js';
import type { Quote, QuoteProviderName } from '../../domain/quote.js';
import type { CancellationToken } from './cancellation.js';

/**
 * 行情 Provider 端口：批量获取多只股票的实时行情。
 * - name: 标识数据来源（eastmoney / tencent），用于缓存标签与诊断。
 * - fetch(): 接收规范化的 StockCode 列表与取消令牌，返回 code→Quote 映射。
 *
 * 实现约束：
 * - 接收注入的 fetch（构造器参数），不直接引用 globalThis.fetch。
 * - 通过 CancellationToken 桥接到 AbortController，传播取消到底层 HTTP 请求。
 * - 价格为 0 或非有限的行必须丢弃（A 股停牌/盘前接口常返回 0.00）。
 * - 返回部分结果：缺失的 code 不出现在结果映射中。
 */
export interface QuoteProvider {
  readonly name: QuoteProviderName;
  fetch(
    codes: readonly StockCode[],
    cancellation: CancellationToken
  ): Promise<Readonly<Record<StockCode, Quote>>>;
}
