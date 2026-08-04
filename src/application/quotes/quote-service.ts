// src/application/quotes/quote-service.ts
// 行情编排核心：批量 / 并发 / 超时 / deadline / 双源降级 / 缓存策略 / 退避 / 诊断 span。
// 纯 Application 层——仅 import domain/* + protocol/* + 同层 application/*。
//
// v2 变更（相对 v1.3）：
// - 退避持久化到 chrome.storage.session（Service Worker 重建后恢复）。
// - 最多 2 批并发（v1.3 顺序逐批）。
// - 父级 8s deadline CancellationSource（v1.3 无全局 deadline）。
// - 每批独立 4s CancellationSource（Clock.schedule 驱动）。
// - 诊断 span exactly-once。
import type { StockCode } from '../../domain/brands.js';
import type { Quote, QuoteCacheEntry, QuoteResult, QuoteSnapshot } from '../../domain/quote.js';
import { isUsableQuote, snapshotFromCache } from '../../domain/quote.js';
import type { QuoteCacheRepository } from '../ports/storage.js';
import type { Clock } from '../ports/clock.js';
import type { QuoteProvider } from '../ports/quote-provider.js';
import type { CancellationToken, CancellationSource } from '../ports/cancellation.js';
import { createCancellationSource } from '../ports/cancellation.js';
import type { SessionStatePort } from '../ports/session-state.js';
import type { DiagnosticSink } from '../ports/diagnostics.js';
import { startSpan } from '../diagnostics/span.js';

// ── 常量（与 v1.3 行为事实一致 + v2 新增） ──

/** 每批 provider 调用超时（毫秒）。 */
const TIMEOUT_MS = 4000;
/** 批大小上限。 */
const CHUNK_SIZE = 50;
/** 默认 freshness 窗口（毫秒）。 */
const DEFAULT_FRESHNESS_MS = 30_000;
/** 缓存最大存活期：7 天（毫秒）。 */
const CACHE_MAX_AGE_MS = 604_800_000;
/** 父级 deadline：8 秢（毫秒），取消所有未完成调用。 */
const DEADLINE_MS = 8000;
/** 最大并发批数。 */
const MAX_CONCURRENCY = 2;
/** 退避延迟序列（毫秒）：30s → 120s → 300s，循环。 */
const BACKOFF_MS: readonly number[] = [30_000, 120_000, 300_000];

// ── 选项类型 ──

/** read 选项。 */
export interface ReadOptions {
  readonly freshnessMs?: number;
}

/** refresh 选项。 */
export interface RefreshOptions {
  readonly force?: boolean;
  readonly requestId?: string;
}

// ── 辅助函数 ──

/** 去重 + 过滤空值。 */
function uniqueCodes(codes: readonly StockCode[]): StockCode[] {
  const seen = new Set<string>();
  const result: StockCode[] = [];
  for (const code of codes) {
    const key = String(code);
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(code);
    }
  }
  return result;
}

/** 将数组切分为固定大小的块。 */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/** 全局 runId 递增计数器（application 层不依赖 crypto 全局）。 */
let runIdCounter = 0;

// ── QuoteService ──

/**
 * 行情编排服务：协调双源 provider、缓存、退避与诊断。
 *
 * 职责：
 * - read(codes, options?): 纯缓存读取 + snapshotFromCache 派生。
 * - refresh(codes, options?): single-flight + 退避检查 + 批量并发 + deadline + 双源降级
 *   + 缓存写入/清理 + 退避更新 + 诊断 span。
 */
export class QuoteService {
  private generation = 0;
  private activeRun: Promise<QuoteSnapshot> | undefined;
  private pendingRun = false;

  constructor(
    private readonly primary: QuoteProvider,
    private readonly fallback: QuoteProvider,
    private readonly cache: Pick<QuoteCacheRepository, 'read' | 'write' | 'delete'>,
    private readonly clock: Clock,
    private readonly session: SessionStatePort,
    private readonly sink: DiagnosticSink
  ) {}

  /**
   * 纯缓存读取：readQuoteCache → snapshotFromCache。
   * 不触发远端请求。
   */
  async read(
    codes: readonly StockCode[],
    options?: ReadOptions
  ): Promise<QuoteSnapshot> {
    const requested = uniqueCodes(codes);
    const now = this.clock.now();
    const freshnessMs = options?.freshnessMs ?? DEFAULT_FRESHNESS_MS;
    const cached = await this.cache.read(requested);
    return snapshotFromCache(cached, requested, now, freshnessMs);
  }

  /**
   * 刷新行情：single-flight + 退避 + 批量并发 + 双源 + 缓存 + 诊断。
   */
  async refresh(
    codes: readonly StockCode[],
    options?: RefreshOptions
  ): Promise<QuoteSnapshot> {
    const requested = uniqueCodes(codes);
    const now = this.clock.now();

    // ── 空自选股守卫 ──
    // 直接返回空快照，不触碰 failureCount、不读写 session。
    if (requested.length === 0) {
      const span = startSpan(this.sink, {
        timestamp: now,
        version: '2.0.0',
        scope: 'quote',
        type: 'refresh',
        counts: { requested: 0 }
      });
      const snapshot: QuoteSnapshot = {
        results: {},
        counts: { fresh: 0, cached: 0, missing: 0 },
        attemptedAt: now,
        succeededAt: null,
        generation: this.generation
      };
      span.end({
        timestamp: now,
        version: '2.0.0',
        scope: 'quote',
        type: 'refresh',
        outcome: 'ok',
        counts: { ...snapshot.counts }
      });
      return snapshot;
    }

    // ── 退避检查 ──
    const backoff = await this.session.readQuoteBackoff();
    if (!options?.force && now < backoff.nextAutomaticAttemptAt) {
      const span = startSpan(this.sink, {
        timestamp: now,
        version: '2.0.0',
        scope: 'quote',
        type: 'refresh',
        counts: { requested: requested.length }
      });
      span.boundary({
        timestamp: now,
        version: '2.0.0',
        scope: 'quote',
        type: 'backoff-deferred',
        outcome: 'degraded',
        counts: { deferred: requested.length }
      });
      const snapshot = await this.read(requested, { freshnessMs: 0 });
      span.end({
        timestamp: now,
        version: '2.0.0',
        scope: 'quote',
        type: 'refresh',
        outcome: 'degraded',
        counts: { ...snapshot.counts }
      });
      return { ...snapshot, attemptedAt: now, deferredUntil: backoff.nextAutomaticAttemptAt };
    }

    // ── single-flight + 执行 ──
    const runId = options?.requestId ?? `run-${++runIdCounter}`;
    return this.singleFlight(() => this.executeRefresh(requested, now, runId));
  }

  // ── single-flight：同一时刻只有一个 refresh 在执行 ──

  private async singleFlight(
    task: () => Promise<QuoteSnapshot>
  ): Promise<QuoteSnapshot> {
    // 若有活跃 run，设 pendingRun=true 并等待；结束后若 pendingRun 则再跑一次。
    while (this.activeRun !== undefined) {
      this.pendingRun = true;
      const current = this.activeRun;
      await current;
      if (this.pendingRun) {
        this.pendingRun = false;
        break; // 我是第一个拾取 pending 标志的——继续执行
      }
      // 其他人已在执行——回到循环等待
    }
    this.activeRun = task();
    try {
      return await this.activeRun;
    } finally {
      this.activeRun = undefined;
    }
  }

  // ── 核心刷新逻辑 ──

  private async executeRefresh(
    requested: StockCode[],
    attemptedAt: number,
    runId: string
  ): Promise<QuoteSnapshot> {
    this.generation += 1;
    const currentGeneration = this.generation;

    const span = startSpan(this.sink, {
      timestamp: attemptedAt,
      version: '2.0.0',
      runId,
      scope: 'quote',
      type: 'refresh',
      counts: { requested: requested.length }
    });

    // 读缓存
    const cached = await this.cache.read(requested);

    // 父级 deadline source（8s）
    const deadlineSource = createCancellationSource();
    const deadlineHandle = this.clock.schedule(DEADLINE_MS, () => deadlineSource.cancel());

    const freshResults: Partial<Record<StockCode, QuoteResult>> = {};
    const cacheWrites: Partial<Record<StockCode, QuoteCacheEntry>> = {};

    try {
      const batches = chunk(requested, CHUNK_SIZE);
      await this.runWithConcurrency(batches, MAX_CONCURRENCY, (batch) =>
        this.processBatch(batch, attemptedAt, deadlineSource, freshResults, cacheWrites)
      );
    } finally {
      deadlineHandle.cancel();
    }

    if (deadlineSource.token.aborted) {
      span.boundary({
        timestamp: this.clock.now(),
        version: '2.0.0',
        runId,
        scope: 'quote',
        type: 'deadline',
        outcome: 'degraded'
      });
    }

    // 写缓存（只写 price>0 的 fresh 行情）
    if (Object.keys(cacheWrites).length > 0) {
      await this.cache.write(cacheWrites as Record<StockCode, QuoteCacheEntry>);
    }

    // 构建结果 + 清理过期缓存
    const results: Record<StockCode, QuoteResult> = {};
    const expired: StockCode[] = [];
    for (const code of requested) {
      if (freshResults[code]) {
        results[code] = freshResults[code]!;
        continue;
      }
      const entry = cached[code];
      const age =
        entry && Number.isFinite(entry.fetchedAt)
          ? Math.max(0, attemptedAt - entry.fetchedAt)
          : Number.POSITIVE_INFINITY;
      if (entry && isUsableQuote(entry.quote) && age <= CACHE_MAX_AGE_MS) {
        results[code] = {
          code,
          status: 'cached',
          source: 'cache',
          provider: entry.provider,
          fetchedAt: entry.fetchedAt,
          quote: entry.quote,
          error: 'unavailable'
        };
      } else {
        if (entry) expired.push(code);
        results[code] = {
          code,
          status: 'missing',
          source: 'none',
          provider: null,
          fetchedAt: null,
          quote: null,
          error: 'unavailable'
        };
      }
    }
    if (expired.length > 0) {
      await this.cache.delete(expired);
    }

    // 构建快照
    const counts = { fresh: 0, cached: 0, missing: 0 };
    for (const r of Object.values(results)) counts[r.status] += 1;

    const snapshot: QuoteSnapshot = {
      results,
      counts,
      attemptedAt,
      succeededAt: counts.fresh > 0 ? attemptedAt : null,
      generation: currentGeneration
    };

    // ── 更新退避 ──
    const currentBackoff = await this.session.readQuoteBackoff();
    if (counts.fresh > 0) {
      // fresh>0 → 重置退避
      await this.session.writeQuoteBackoff({ failureCount: 0, nextAutomaticAttemptAt: 0 });
    } else {
      // fresh===0 → 推进退避
      const newFailureCount = currentBackoff.failureCount + 1;
      const delay = BACKOFF_MS[Math.min(newFailureCount - 1, BACKOFF_MS.length - 1)];
      await this.session.writeQuoteBackoff({
        failureCount: newFailureCount,
        nextAutomaticAttemptAt: attemptedAt + delay
      });
    }

    span.end({
      timestamp: this.clock.now(),
      version: '2.0.0',
      runId,
      scope: 'quote',
      type: 'refresh',
      outcome: counts.fresh > 0 ? 'ok' : counts.cached > 0 ? 'degraded' : 'failed',
      durationMs: this.clock.now() - attemptedAt,
      counts: { ...counts }
    });

    return snapshot;
  }

  // ── 单批处理：primary → fallback → 合并 fresh 结果 ──

  private async processBatch(
    batch: StockCode[],
    attemptedAt: number,
    deadlineSource: CancellationSource,
    freshResults: Partial<Record<StockCode, QuoteResult>>,
    cacheWrites: Partial<Record<StockCode, QuoteCacheEntry>>
  ): Promise<void> {
    if (deadlineSource.token.aborted) return;

    // ── Primary (Eastmoney) ──
    await this.callProvider(
      this.primary,
      batch,
      attemptedAt,
      deadlineSource,
      freshResults,
      cacheWrites
    );

    // ── Fallback (Sina)：只查 primary 缺失的 code ──
    const missing = batch.filter((code) => !freshResults[code]);
    if (missing.length === 0 || deadlineSource.token.aborted) return;

    await this.callProvider(
      this.fallback,
      missing,
      attemptedAt,
      deadlineSource,
      freshResults,
      cacheWrites
    );
  }

  /**
   * 调用单个 provider：创建 4s CancellationSource（Clock.schedule 驱动），
   * 父级 deadline 取消时联动取消。成功且 price>0 的结果写入 freshResults + cacheWrites。
   */
  private async callProvider(
    provider: QuoteProvider,
    codes: StockCode[],
    attemptedAt: number,
    deadlineSource: CancellationSource,
    freshResults: Partial<Record<StockCode, QuoteResult>>,
    cacheWrites: Partial<Record<StockCode, QuoteCacheEntry>>
  ): Promise<void> {
    const source = createCancellationSource();
    const handle = this.clock.schedule(TIMEOUT_MS, () => source.cancel());
    // 父级 deadline 联动取消
    const unlink = deadlineSource.token.onCancel(() => source.cancel());

    try {
      const values = await provider.fetch(codes, source.token);
      for (const code of codes) {
        const quote: Quote | undefined = values[code];
        if (quote && isUsableQuote(quote)) {
          freshResults[code] = {
            code,
            status: 'fresh',
            source: provider.name,
            provider: provider.name,
            fetchedAt: attemptedAt,
            quote,
            error: null
          };
          cacheWrites[code] = {
            cacheVersion: 1,
            code,
            provider: provider.name,
            fetchedAt: attemptedAt,
            quote
          };
        }
      }
    } catch {
      // provider 调用失败（超时 / 网络 / 解析）——静默跳过，后续 fallback 或缓存兜底
    } finally {
      handle.cancel();
      unlink();
    }
  }

  // ── 并发池：最多 `concurrency` 个 worker 同时处理 items ──

  private async runWithConcurrency<T>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T) => Promise<void>
  ): Promise<void> {
    let index = 0;
    const worker = async (): Promise<void> => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        await fn(current);
      }
    };
    const workers: Promise<void>[] = [];
    const workerCount = Math.min(concurrency, items.length);
    for (let i = 0; i < workerCount; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }
}
