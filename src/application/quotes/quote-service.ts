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

/**
 * 构造 single-flight 归并键：排序后的 code 集合 + force 标志。
 * 排序保证「顺序不同、集合相同」的请求仍归并为一次运行；
 * force 参与键值——用户主动刷新不应被并入一个正在跑的后台刷新。
 */
function refreshKey(codes: readonly StockCode[], force: boolean): string {
  return `${force ? 'force' : 'auto'}:${[...codes].map(String).sort().join(',')}`;
}

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
  /**
   * 进行中的刷新，按「请求意图」键归并。
   * 键包含 code 集合与 force 标志——只认「有没有在跑」会把 A 的快照回给请求
   * 不同集合的 B（Popup 与后台 scheduler 的 watchlist 快照可能不一致，
   * 刚加完股票时尤其如此），导致 B 新增的股票被静默丢弃、渲染成「缺失」。
   */
  private readonly activeRuns = new Map<string, Promise<QuoteSnapshot>>();

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
    const key = refreshKey(requested, options?.force === true);
    return this.singleFlight(key, () => this.executeRefresh(requested, now, runId));
  }

  // ── single-flight：相同意图（同 code 集合 + 同 force 标志）的并发刷新归并 ──

  private singleFlight(
    key: string,
    task: () => Promise<QuoteSnapshot>
  ): Promise<QuoteSnapshot> {
    // 同 key 的并发调用共享同一 Promise；不同 key 各自独立执行，
    // 保证每个调用方拿到的快照确实覆盖它请求的 code 集合。
    const existing = this.activeRuns.get(key);
    if (existing) return existing;
    const run = (async () => {
      try {
        return await task();
      } finally {
        this.activeRuns.delete(key);
      }
    })();
    this.activeRuns.set(key, run);
    return run;
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
        this.processBatch(batch, attemptedAt, deadlineSource, freshResults, cacheWrites, runId)
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
    cacheWrites: Partial<Record<StockCode, QuoteCacheEntry>>,
    runId: string
  ): Promise<void> {
    if (deadlineSource.token.aborted) return;

    // ── Primary (Eastmoney) ──
    await this.callProvider(
      this.primary,
      batch,
      attemptedAt,
      deadlineSource,
      freshResults,
      cacheWrites,
      runId
    );

    // ── Fallback (Tencent)：只查 primary 缺失的 code ──
    const missing = batch.filter((code) => !freshResults[code]);
    if (missing.length === 0 || deadlineSource.token.aborted) return;

    await this.callProvider(
      this.fallback,
      missing,
      attemptedAt,
      deadlineSource,
      freshResults,
      cacheWrites,
      runId
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
    cacheWrites: Partial<Record<StockCode, QuoteCacheEntry>>,
    runId: string
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
    } catch (error) {
      // provider 调用失败（超时 / 网络 / 解析）——由 fallback 或缓存兜底，
      // 但**必须留下痕迹**：此处此前是空 catch，导致「备源永久返回 403」
      // 这类故障在生产和全部单测中都完全不可见，直到实网验证才暴露。
      this.sink.emit({
        timestamp: this.clock.now(),
        version: '2.0.0',
        runId,
        scope: 'quote',
        type: 'provider-failed',
        outcome: 'failed',
        provider: provider.name,
        reason: error instanceof Error ? error.message : 'unknown',
        counts: { codes: codes.length }
      });
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
