// src/application/charts/chart-service.ts
// ChartService：分时/K线用例——远端历史行情 + 4s 超时 + single-flight + 诊断。
// 纯 Application 层——仅 import domain/* + protocol/* + 同层 application/*。
//
// 与 QuoteService 的区别：历史行情是「按需明细」（点开才拉），不做后台周期刷新；
// 不做持久缓存（chrome.storage 的保留集/孤儿清理不涉及图表数据——它是一次性
// 明细，不是常驻行情）；失败直接返回错误交由 UI 呈现「加载失败，重试」。
import type { StockCode } from '../../domain/brands.js';
import type { ChartData, ChartKind, KlinePeriod, ChartError, TrendPoint, KlineBar } from '../../domain/chart.js';
import { isUsableTrends, isUsableKlines } from '../../domain/chart.js';
import type { Clock } from '../ports/clock.js';
import type { DiagnosticSink } from '../ports/diagnostics.js';
import type { CancellationToken } from '../ports/cancellation.js';
import { createCancellationSource } from '../ports/cancellation.js';

/** 图表请求超时（毫秒）——与行情 provider 的 4s 一致。 */
const CHART_TIMEOUT_MS = 4000;

/** 图表 Provider 端口（传输层：loadTrends / loadKline 二选一）。 */
export interface ChartProviderPort {
  fetch(
    code: StockCode,
    kind: ChartKind,
    period: KlinePeriod,
    cancellation: CancellationToken
  ): Promise<TrendsPayload | KlinePayload>;
}

/** Provider 返回的领域形状（由图表服务直接消费）。 */
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

/**
 * 历史行情服务：single-flight（同 code+kind+period 归并）+ 超时 + 诊断。
 * fetch 结果必须经 isUsableTrends/isUsableKlines 验证——不可用即返回错误，
 * 绝不把空/零价数据当作「无数据」传给画布（不生成模拟曲线）。
 */
export class ChartService {
  private readonly activeRuns = new Map<string, Promise<ChartData>>();
  private runIdCounter = 0;

  constructor(
    private readonly provider: ChartProviderPort,
    private readonly clock: Clock,
    private readonly sink: DiagnosticSink
  ) {}

  async load(
    code: StockCode,
    kind: ChartKind,
    period: KlinePeriod
  ): Promise<ChartData> {
    const key = `${code}|${kind}|${period}`;
    const existing = this.activeRuns.get(key);
    if (existing) return existing;
    const run = (async () => {
      try {
        return await this.execute(code, kind, period);
      } finally {
        this.activeRuns.delete(key);
      }
    })();
    this.activeRuns.set(key, run);
    return run;
  }

  private async execute(code: StockCode, kind: ChartKind, period: KlinePeriod): Promise<ChartData> {
    const runId = `chart-${++this.runIdCounter}`;
    const attemptedAt = this.clock.now();
    const source = createCancellationSource();
    const handle = this.clock.schedule(CHART_TIMEOUT_MS, () => source.cancel());
    try {
      const raw = await this.provider.fetch(code, kind, period, source.token);
      const cleaned = this.normalize(raw, code, kind, attemptedAt);
      return cleaned;
    } catch (error) {
      // 超时/网络/解析失败——提供明确错误（UI 显示「加载失败，重试」）。
      this.sink.emit({
        timestamp: this.clock.now(),
        version: '2.0.0',
        runId,
        scope: 'chart',
        type: 'load-failed',
        outcome: 'failed',
        reason: error instanceof Error ? error.message : 'unknown',
        counts: { codes: 1 }
      });
      throw error;
    } finally {
      handle.cancel();
    }
  }

  /** 将 Provider 原始形状收敛为领域 ChartData（可用性校验在此，不生成模拟数据）。 */
  private normalize(
    raw: unknown,
    code: StockCode,
    kind: ChartKind,
    fetchedAt: number
  ): ChartData {
    if (kind === 'trends') {
      const payload = raw as TrendsPayload;
      if (!isUsableTrends(payload.points)) {
        throw new Error('trends unavailable');
      }
      return {
        code,
        kind,
        name: payload.name,
        prevClose: payload.prevClose,
        trends: payload.points,
        fetchedAt
      };
    }
    const payload = raw as KlinePayload;
    if (!isUsableKlines(payload.bars)) {
      throw new Error('kline unavailable');
    }
    return {
      code,
      kind,
      name: payload.name,
      klines: payload.bars,
      fetchedAt
    };
  }
}

/** ChartError 工厂（RPC 层用）。 */
export function chartError(message: string, retryable = true): ChartError {
  return { code: 'CHART_LOAD_FAILED', message, retryable };
}
