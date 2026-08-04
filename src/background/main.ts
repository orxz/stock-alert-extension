// src/background/main.ts
// Background 控制平面入口（Service Worker 顶层模块）。
//
// 核心契约（brief Step 6 逐字 + Task 11 扩展）：
// - 同步注册所有 Chrome listener（onMessage/onAlarm/onInstalled/onStartup/onStorageChanged），
//   无顶层 await 先于 listener 注册——SW 在任何事件到达前完成接线。
// - createRuntimeDependencies() 创建轻量 adapter + scheduler（eager）+ 惰性 barrier。
//   scheduler 的 bootstrap/quotes delegate 通过 barrier.get() 惰性获取服务。
// - barrier.initialize factory 在首次 get() 时：
//   (a) 创建 Coordinator + Repositories + Services（迁移/备份）；
//   (b) coordinator.reconcileOrphanQuoteCache()——孤儿缓存清理；
//   (c) session.readQuoteBackoff——清理非法退避值后写回；
//   (d) scheduler.ensureAlarm()——SW 重建后恢复 alarm。
// - ensureInitialized('module-activation') fire-and-forget：失败经诊断 sink 记录，下一事件重试。
// - onAlarm：alarm.name === ALARM_NAME → scheduler.runQuoteCycle('alarm')。
// - onInstalled/onStartup → scheduler.runQuoteCycle('installed'/'startup')。
// - onStorageChanged：groups/watchlist/boardConfig 变更 → scheduler.runQuoteCycle('storage-change')；
//   quoteCache 变更不触发（防递归）。
import type { Clock, Cancelable } from '../application/ports/clock.js';
import type { DiagnosticEvent } from '../application/ports/diagnostics.js';
import type { StockCode } from '../domain/brands.js';
import type { QuoteSnapshot } from '../domain/quote.js';
import type { BootstrapResult } from '../protocol/messages.js';
import type { RefreshOptions } from '../application/quotes/quote-service.js';
import { createInitializationBarrier } from './initialization-barrier.js';
import { createRouter } from './router.js';
import type { AppServices } from './rpc-handlers.js';
import { createConsoleDiagnosticSink } from '../infrastructure/chrome/console-diagnostic-sink.js';
import { createChromeSessionState } from '../infrastructure/chrome/chrome-session-state.js';
import { createChromeAlarmAdapter } from '../infrastructure/chrome/chrome-alarm-adapter.js';
import { createChromeActionPresenter } from '../infrastructure/chrome/chrome-action-presenter.js';
import { ChromeStorageAdapter } from '../infrastructure/storage/chrome-storage-adapter.js';
import { StorageCoordinator } from '../infrastructure/storage/storage-coordinator.js';
import { UserDataRepositoryImpl } from '../infrastructure/storage/user-data-repository.js';
import { QuoteCacheRepositoryImpl } from '../infrastructure/storage/quote-cache-repository.js';
import { BootstrapService } from '../application/bootstrap/bootstrap-service.js';
import { PortfolioCommandsImpl } from '../application/portfolio/commands.js';
import { QuoteService } from '../application/quotes/quote-service.js';
import { SearchService } from '../application/search/search-service.js';
import { EastmoneyQuoteProvider } from '../infrastructure/quote-providers/eastmoney-quote-provider.js';
import { SinaQuoteProvider } from '../infrastructure/quote-providers/sina-quote-provider.js';
import { EastmoneySearchProvider } from '../infrastructure/quote-providers/eastmoney-search-provider.js';
import { searchLocalCatalog } from '../infrastructure/quote-providers/local-stock-catalog.js';
import { QuoteScheduler, ALARM_NAME } from './scheduler.js';

/**
 * SystemClock：生产时钟。now() 委托 Date.now()；schedule() 委托 setTimeout/clearTimeout。
 * 在 WebWorker lib 中 setTimeout/clearTimeout 可用（Service Worker 全局）。
 */
function createSystemClock(): Clock {
  return {
    now(): number {
      return Date.now();
    },
    schedule(delayMs: number, callback: () => void): Cancelable {
      const id = setTimeout(callback, delayMs);
      return {
        cancel(): void {
          clearTimeout(id as unknown as Parameters<typeof clearTimeout>[0]);
        }
      };
    }
  };
}

/** onStorageChanged 触发 cycle 的键集合。 */
const STORAGE_TRIGGER_KEYS = new Set(['groups', 'watchlist', 'boardConfig']);

/**
 * 创建运行时依赖：轻量 adapter + scheduler（eager）+ 惰性初始化 barrier + router。
 *
 * scheduler 在 barrier 之前 eager 创建——其 bootstrap/quotes delegate 通过 barrier.get()
 * 惰性获取已初始化的服务。barrier.initialize factory 在首次 get() 时：
 * (a) 创建 Coordinator + Repositories + Services（迁移/备份）；
 * (b) coordinator.reconcileOrphanQuoteCache()——孤儿缓存清理；
 * (c) session.readQuoteBackoff——清理非法退避值后写回；
 * (d) scheduler.ensureAlarm()——SW 重建后恢复 alarm。
 */
function createRuntimeDependencies() {
  const sink = createConsoleDiagnosticSink();
  const clock = createSystemClock();
  const alarm = createChromeAlarmAdapter();
  const action = createChromeActionPresenter();

  // scheduler 先声明（let）后赋值——barrier factory 引用 scheduler.ensureAlarm()，
  // lazyBootstrap/lazyQuotes 引用 barrier；所有引用在 factory 首次执行时已初始化。
  let scheduler: QuoteScheduler;

  const barrier = createInitializationBarrier<AppServices>(async () => {
    const area = new ChromeStorageAdapter();
    const coordinator = new StorageCoordinator({ area, clock: () => clock.now() });
    const userDataRepository = new UserDataRepositoryImpl(coordinator);
    const quoteCacheRepository = new QuoteCacheRepositoryImpl(coordinator);
    const sessionState = createChromeSessionState();

    // fetch 必须绑定 globalThis：provider 以 this.fetchFn(url) 方法调用，
    // 未绑定会抛 "Illegal invocation"（调用方 this 为 undefined）。
    const boundFetch = fetch.bind(globalThis);
    const primary = new EastmoneyQuoteProvider(boundFetch);
    const fallback = new SinaQuoteProvider(boundFetch);
    const searchProvider = new EastmoneySearchProvider(boundFetch);

    const bootstrap = new BootstrapService(userDataRepository, clock);
    const portfolio = new PortfolioCommandsImpl(userDataRepository, clock);
    const quotes = new QuoteService(primary, fallback, quoteCacheRepository, clock, sessionState, sink);
    const search = new SearchService(searchProvider, searchLocalCatalog, clock);

    // ── 初始化工厂扩展（brief Step 6）──
    // (b) 孤儿缓存清理：删除不在 watchlist 中的 quoteCache:* 条目。
    await coordinator.reconcileOrphanQuoteCache().catch((error: unknown) => {
      sink.emit({
        timestamp: clock.now(),
        version: '2.0.0',
        scope: 'storage',
        type: 'reconcile-orphan-cache-failed',
        outcome: 'failed'
      });
      void error;
    });

    // (c) session 退避清理：读取退避状态（ChromeSessionState 内部 clamp 非法值），写回清洁值。
    const backoff = await sessionState.readQuoteBackoff();
    await sessionState.writeQuoteBackoff(backoff);

    // (d) ensureAlarm：SW 重建后 alarm 丢失时恢复 safety alarm。
    await scheduler.ensureAlarm();

    return { bootstrap, portfolio, quotes, search };
  });

  // Lazy bootstrap/quotes delegate：通过 barrier.get() 惰性获取已初始化的服务。
  // scheduler 用这些 delegate 构造，在 barrier ready 后才实际调用 bootstrap/quotes。
  const lazyBootstrap: { execute(): Promise<BootstrapResult> } = {
    async execute(): Promise<BootstrapResult> {
      const services = await barrier.get();
      return services.bootstrap.execute();
    }
  };
  const lazyQuotes: {
    refresh(codes: readonly StockCode[], options?: RefreshOptions): Promise<QuoteSnapshot>;
  } = {
    async refresh(codes: readonly StockCode[], options?: RefreshOptions): Promise<QuoteSnapshot> {
      const services = await barrier.get();
      return services.quotes.refresh(codes, options);
    }
  };

  // Eager scheduler：bootstrap/quotes 惰性，alarm/action/clock/sink eager。
  scheduler = new QuoteScheduler({
    bootstrap: lazyBootstrap,
    quotes: lazyQuotes,
    alarm,
    action,
    clock,
    sink
  });

  const router = createRouter({ barrier, sink, clock });

  /**
   * fire-and-forget 激活：触发首次初始化，失败经诊断 sink 记录（不缓存错误）。
   * 下一事件经 barrier.get() 自动重试。
   */
  const ensureInitialized = (reason: string): void => {
    void barrier.get().catch((error: unknown) => {
      const event: DiagnosticEvent = {
        timestamp: clock.now(),
        version: '2.0.0',
        scope: 'rpc',
        type: `init-failed:${reason}`,
        outcome: 'failed'
      };
      sink.emit(event);
      void error;
    });
  };

  // ── Chrome listener ──
  const onAlarm = (alarm: chrome.alarms.Alarm): void => {
    if (alarm.name === ALARM_NAME) {
      void scheduler.runQuoteCycle('alarm');
    }
  };
  const onInstalled = (_details: chrome.runtime.InstalledDetails): void => {
    void scheduler.runQuoteCycle('installed');
  };
  const onStartup = (): void => {
    void scheduler.runQuoteCycle('startup');
  };
  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    _areaName: chrome.storage.AreaName
  ): void => {
    // groups/watchlist/boardConfig 变更触发 coalesced cycle；quoteCache 变更不触发（防递归）。
    for (const key of Object.keys(changes)) {
      if (STORAGE_TRIGGER_KEYS.has(key)) {
        void scheduler.runQuoteCycle('storage-change');
        return;
      }
    }
  };

  return { router, onAlarm, onInstalled, onStartup, onStorageChanged, ensureInitialized };
}

// ===== 同步注册所有 Chrome listener（无顶层 await 先于注册）=====
const runtime = createRuntimeDependencies();
chrome.runtime.onMessage.addListener(runtime.router.handle);
chrome.alarms.onAlarm.addListener(runtime.onAlarm);
chrome.runtime.onInstalled.addListener(runtime.onInstalled);
chrome.runtime.onStartup.addListener(runtime.onStartup);
chrome.storage.onChanged.addListener(runtime.onStorageChanged);
void runtime.ensureInitialized('module-activation');
