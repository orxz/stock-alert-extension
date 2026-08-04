// src/background/main.ts
// Background 控制平面入口（Service Worker 顶层模块）。
//
// 核心契约（brief Step 6 逐字）：
// - 同步注册所有 Chrome listener（onMessage/onAlarm/onInstalled/onStartup/onStorageChanged），
//   无顶层 await 先于 listener 注册——SW 在任何事件到达前完成接线。
// - createRuntimeDependencies() 仅创建轻量 adapter + 惰性 barrier（initialize factory 推迟到首次 get()）。
// - ensureInitialized('module-activation') fire-and-forget：失败经诊断 sink 记录，下一事件经 barrier 重试。
// - router.handle 绑定到 onMessage listener；其余 listener 当前为 no-op（Task 11 接入 scheduler）。
import type { Clock, Cancelable } from '../application/ports/clock.js';
import type { DiagnosticEvent } from '../application/ports/diagnostics.js';
import { createInitializationBarrier } from './initialization-barrier.js';
import { createRouter } from './router.js';
import type { AppServices } from './rpc-handlers.js';
import { createConsoleDiagnosticSink } from '../infrastructure/chrome/console-diagnostic-sink.js';
import { createChromeSessionState } from '../infrastructure/chrome/chrome-session-state.js';
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

/**
 * 创建运行时依赖：轻量 adapter + 惰性初始化 barrier + router。
 *
 * barrier.initialize factory 在首次 get() 时创建 Coordinator + Repositories + Services，
 * 返回 AppServices 捆绑。失败回 idle，下一事件重试。
 */
function createRuntimeDependencies() {
  const sink = createConsoleDiagnosticSink();
  const clock = createSystemClock();

  const barrier = createInitializationBarrier<AppServices>(async () => {
    const area = new ChromeStorageAdapter();
    const coordinator = new StorageCoordinator({ area, clock: () => clock.now() });
    const userDataRepository = new UserDataRepositoryImpl(coordinator);
    const quoteCacheRepository = new QuoteCacheRepositoryImpl(coordinator);
    const sessionState = createChromeSessionState();

    const primary = new EastmoneyQuoteProvider(fetch);
    const fallback = new SinaQuoteProvider(fetch);
    const searchProvider = new EastmoneySearchProvider(fetch);

    const bootstrap = new BootstrapService(userDataRepository, clock);
    const portfolio = new PortfolioCommandsImpl(userDataRepository, clock);
    const quotes = new QuoteService(primary, fallback, quoteCacheRepository, clock, sessionState, sink);
    const search = new SearchService(searchProvider, searchLocalCatalog, clock);

    return { bootstrap, portfolio, quotes, search };
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
      // 诊断记录错误标签但不泄漏 stack/message 到控制台之外。
      void error;
    });
  };

  // ── Chrome listener：当前 onAlarm/onInstalled/onStartup/onStorageChanged 为 no-op ──
  // Task 11 将接入完整 scheduler（行情刷新调度 / 安装迁移 / 存储变更广播）。
  const onAlarm = (_alarm: chrome.alarms.Alarm): void => {
    void _alarm;
  };
  const onInstalled = (_details: chrome.runtime.InstalledDetails): void => {
    void _details;
  };
  const onStartup = (): void => {
    // no-op：Task 11 接入。
  };
  const onStorageChanged = (
    _changes: Record<string, chrome.storage.StorageChange>,
    _areaName: chrome.storage.AreaName
  ): void => {
    void _changes;
    void _areaName;
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
