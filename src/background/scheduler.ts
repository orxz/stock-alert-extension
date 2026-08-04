// src/background/scheduler.ts
// 行情刷新调度器：safety-before-work + exact-after-work + single-flight + coalesced retry。
//
// 核心契约（brief Step 5 逐字 + 用户计划 Step 6）：
// - runQuoteCycle(source)：single-flight 并发控制——活跃 run 进行中时新触发折叠为 pendingRun，
//   活跃 run 结束后若 pendingRun 则以 'coalesced' 源重跑一次。
// - safety-before-work：每次 cycle 开始先安排 5 分钟 safety alarm（防 SW 被杀后丢失调度）。
// - exact-after-work：工作结束后安排精确 interval alarm（盘中 30s / 盘外 5min）。
// - 空 watchlist：action.clear，不调 QuoteService 或 SessionStatePort。
// - runId 贯穿诊断：cycle:start / cycle:end / update-action-failed 共享同一 runId。
// - provider/cache 失败：updateAction 内部 catch，不抛出——调度循环不中断。
import type { Clock } from '../application/ports/clock.js';
import type { DiagnosticSink } from '../application/ports/diagnostics.js';
import type { AlarmPort } from '../application/ports/alarm.js';
import type { ActionPresenterPort } from '../application/ports/action-presenter.js';
import type { BootstrapResult } from '../protocol/messages.js';
import type { RefreshOptions } from '../application/quotes/quote-service.js';
import type { GroupId, StockCode } from '../domain/brands.js';
import type { QuoteSnapshot } from '../domain/quote.js';
import type { BoardConfig } from '../domain/board-config.js';
import { sortStocks, stocksForGroup } from '../domain/portfolio.js';
import { getRefreshIntervalMs } from '../domain/formatting.js';
import { startSpan } from '../application/diagnostics/span.js';
import { projectActionState } from './badge-presenter.js';

/** Alarm 名称（唯一标识后台行情刷新定时器）。 */
export const ALARM_NAME = 'quote-refresh:v2';

/** Safety delay：5 分钟——cycle 开始时先安排一个 safety alarm 防 SW 被杀。 */
export const SAFETY_DELAY_MS = 300_000;

/** 空看板标题。 */
const EMPTY_TITLE = '股票提醒助手\n暂无自选股，点击添加';

/** `g_all` 分组 ID（固定计算视图，badge/tooltip 投影基于此分组）。 */
const ALL_GROUP_ID = 'g_all' as GroupId;

/** 默认看板配置（boardConfig 缺失 g_all 条目时的回退值）。 */
const DEFAULT_BOARD_CONFIG: BoardConfig = {
  viewMode: 'list',
  sortField: 'manual',
  sortDirection: 'desc',
  priceHidden: false
};

/** 触发行情刷新周期的来源。 */
export type QuoteRunSource =
  | 'alarm'
  | 'installed'
  | 'startup'
  | 'storage-change'
  | 'coalesced'
  | 'module-activation';

/** Scheduler 依赖：结构化方法签名，生产实例与测试 mock 均可满足。 */
export interface SchedulerDeps {
  readonly bootstrap: { execute(): Promise<BootstrapResult> };
  readonly quotes: {
    refresh(codes: readonly StockCode[], options?: RefreshOptions): Promise<QuoteSnapshot>;
  };
  readonly alarm: AlarmPort;
  readonly action: ActionPresenterPort;
  readonly clock: Clock;
  readonly sink: DiagnosticSink;
}

/**
 * 行情刷新调度器：协调 alarm 安全调度、badge/tooltip 投影与 single-flight 并发控制。
 *
 * - ensureAlarm()：SW 激活时检查 alarm 是否存在，缺失则安排 safety alarm。
 * - runQuoteCycle(source)：single-flight + safety-before-work + updateAction + exact-after-work。
 */
export class QuoteScheduler {
  private activeRun: Promise<void> | undefined;
  private pendingRun = false;
  private runIdCounter = 0;

  constructor(private readonly deps: SchedulerDeps) {}

  /**
   * 确保 alarm 存在：SW 激活 / 初始化时调用。
   * 若 alarm.get(ALARM_NAME) 返回 null（SW 重建后 alarm 丢失），安排一个 safety alarm。
   */
  async ensureAlarm(): Promise<void> {
    const existing = await this.deps.alarm.get(ALARM_NAME);
    if (existing === null) {
      await this.deps.alarm.schedule(ALARM_NAME, this.deps.clock.now() + SAFETY_DELAY_MS);
    }
  }

  /**
   * 执行一次行情刷新周期（brief Step 5 逐字 single-flight）。
   *
   * 并发触发折叠：活跃 run 进行中时，新触发设 pendingRun=true 并返回活跃 run；
   * 活跃 run 结束后若 pendingRun，以 'coalesced' 源重跑一次。
   *
   * safety-before-work：先安排 5min safety alarm（防 SW 被杀后丢失调度）。
   * exact-after-work：工作结束后安排精确 interval alarm（盘中 30s / 盘外 5min）。
   */
  async runQuoteCycle(source: QuoteRunSource): Promise<void> {
    if (this.activeRun) {
      this.pendingRun = true;
      return this.activeRun;
    }
    const runId = `bg-${++this.runIdCounter}`;
    const { clock, sink, alarm } = this.deps;
    const startedAt = clock.now();
    const span = startSpan(sink, {
      timestamp: startedAt,
      version: '2.0.0',
      runId,
      scope: 'scheduler',
      type: 'cycle'
    });

    this.activeRun = (async () => {
      // ── safety-before-work ──
      await alarm.schedule(ALARM_NAME, clock.now() + SAFETY_DELAY_MS);
      try {
        await this.updateAction(source, runId);
      } finally {
        // ── exact-after-work ──
        const after = clock.now();
        await alarm.schedule(ALARM_NAME, after + getRefreshIntervalMs(after, 'background'));
      }
    })().finally(() => {
      this.activeRun = undefined;
    });

    try {
      await this.activeRun;
    } finally {
      span.end({
        timestamp: clock.now(),
        version: '2.0.0',
        runId,
        scope: 'scheduler',
        type: 'cycle',
        outcome: 'ok',
        durationMs: clock.now() - startedAt
      });

      if (this.pendingRun) {
        this.pendingRun = false;
        await this.runQuoteCycle('coalesced');
      }
    }
  }

  /**
   * 更新 Badge/Tooltip（best-effort：内部 catch 所有错误，不抛出）。
   *
   * 流程：
   * 1. bootstrap.execute() → userData + cacheSnapshot
   * 2. 空 watchlist → action.clear，不调 QuoteService
   * 3. 非空：
   *    a. Phase 1（cache）：sortStocks + projectActionState + action.render（即时缓存投影）
   *    b. Phase 2（network）：quotes.refresh → sortStocks + projectActionState + action.render（新鲜投影）
   *
   * 错误处理：catch 所有异常 → 发射 update-action-failed 诊断（含 runId），不抛出。
   */
  private async updateAction(source: QuoteRunSource, runId: string): Promise<void> {
    const { clock, sink, bootstrap, quotes, action } = this.deps;
    const updateStartedAt = clock.now();
    try {
      const boot = await bootstrap.execute();
      const stocks = stocksForGroup(boot.userData.watchlist, ALL_GROUP_ID);

      // ── 空 watchlist：清 badge，不调 QuoteService ──
      if (stocks.length === 0) {
        await action.clear(EMPTY_TITLE);
        return;
      }

      const config = boot.userData.boardConfig[ALL_GROUP_ID] ?? DEFAULT_BOARD_CONFIG;

      // ── Phase 1：cache 即时投影 ──
      const cacheSorted = sortStocks(stocks, boot.quoteSnapshot, ALL_GROUP_ID, config);
      await action.render(projectActionState(cacheSorted, boot.quoteSnapshot, clock.now()));

      // ── Phase 2：network 刷新 + 新鲜投影 ──
      const codes = stocks.map((stock) => stock.code);
      const fresh = await quotes.refresh(codes, { requestId: runId });
      const freshSorted = sortStocks(stocks, fresh, ALL_GROUP_ID, config);
      await action.render(projectActionState(freshSorted, fresh, clock.now()));
    } catch (error) {
      sink.emit({
        timestamp: clock.now(),
        version: '2.0.0',
        runId,
        scope: 'scheduler',
        type: 'update-action-failed',
        outcome: 'failed',
        durationMs: clock.now() - updateStartedAt
      });
      void source;
      void error;
    }
  }
}
