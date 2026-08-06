// tests/unit/background/scheduler.test.ts
// Task 11 — QuoteScheduler 测试（brief Step 1 逐字 + 扩展覆盖）：
// safety-before-work + exact-after-work / ensureAlarm 重建缺失 alarm / 空 watchlist clear badge /
// SW 重建 / 并发 trigger collapse / storage-triggered / provider/cache failure 不停止调度 /
// correlated runId diagnostics。
import assert from 'node:assert/strict';
import test from 'node:test';

import { QuoteScheduler, ALARM_NAME, SAFETY_DELAY_MS } from '../../../src/background/scheduler.js';
import type { QuoteRunSource } from '../../../src/background/scheduler.js';
import type { BootstrapResult } from '../../../src/protocol/messages.js';
import type { QuoteSnapshot, QuoteResult } from '../../../src/domain/quote.js';
import type { StockCode } from '../../../src/domain/brands.js';
import type { Stock } from '../../../src/domain/stock.js';
import type { RefreshOptions } from '../../../src/application/quotes/quote-service.js';
import type { DiagnosticEvent } from '../../../src/application/ports/diagnostics.js';
import { FixedClock } from '../../helpers/fixed-clock.js';
import { FakeAlarmPort } from '../../helpers/fake-alarm-port.js';
import { FakeActionPresenter } from '../../helpers/fake-action-presenter.js';

// NOW = 2024-03-15 10:00 Shanghai (Friday 盘中) → getRefreshIntervalMs(background) = 30_000
const NOW = 1710468000000;

function sc(value: string): StockCode {
  return value as StockCode;
}

// ── Fixtures ──

const EMPTY_USER_DATA = {
  schemaVersion: 2 as const,
  groups: [],
  watchlist: [] as readonly Stock[],
  boardConfig: {}
};

const EMPTY_SNAPSHOT: QuoteSnapshot = {
  results: {},
  counts: { fresh: 0, cached: 0, missing: 0 },
  attemptedAt: NOW,
  succeededAt: null,
  generation: 0
};

const EMPTY_BOOTSTRAP: BootstrapResult = {
  version: '2.0.0',
  userData: EMPTY_USER_DATA,
  revision: 'sha256:empty',
  quoteSnapshot: EMPTY_SNAPSHOT
};

const STOCK: Stock = {
  code: sc('sh600519'),
  name: '贵州茅台',
  groupIds: [],
  manualOrder: {},
  pinned: {},
  addedAt: 1000
};

const FRESH_RESULT: QuoteResult = {
  code: sc('sh600519'),
  status: 'fresh',
  source: 'eastmoney',
  provider: 'eastmoney',
  fetchedAt: NOW,
  quote: {
    code: sc('sh600519'),
    name: '贵州茅台',
    price: 1800,
    change: 10,
    changePercent: 0.5,
    amount: 1_000_000
  },
  error: null
};

const NON_EMPTY_SNAPSHOT: QuoteSnapshot = {
  results: { sh600519: FRESH_RESULT },
  counts: { fresh: 1, cached: 0, missing: 0 },
  attemptedAt: NOW,
  succeededAt: NOW,
  generation: 1
};

const NON_EMPTY_USER_DATA = {
  schemaVersion: 2 as const,
  groups: [],
  watchlist: [STOCK] as readonly Stock[],
  boardConfig: {}
};

const NON_EMPTY_BOOTSTRAP: BootstrapResult = {
  version: '2.0.0',
  userData: NON_EMPTY_USER_DATA,
  revision: 'sha256:nonempty',
  quoteSnapshot: NON_EMPTY_SNAPSHOT
};

// ── Scheduler factory ──

interface SchedulerHarness {
  scheduler: QuoteScheduler;
  alarm: FakeAlarmPort;
  action: FakeActionPresenter;
  clock: FixedClock;
  events: DiagnosticEvent[];
  bootstrapCalls: { value: number };
  refreshCalls: { value: number };
}

function createScheduler(
  overrides?: {
    bootstrapResult?: BootstrapResult;
    refreshResult?: QuoteSnapshot;
    bootstrapFn?: () => Promise<BootstrapResult>;
    refreshFn?: (codes: readonly StockCode[], options?: RefreshOptions) => Promise<QuoteSnapshot>;
  }
): SchedulerHarness {
  const alarm = new FakeAlarmPort();
  const action = new FakeActionPresenter();
  const clock = new FixedClock(NOW);
  const events: DiagnosticEvent[] = [];
  const sink = { emit: (e: DiagnosticEvent) => events.push(e) };

  const bootstrapCalls = { value: 0 };
  const refreshCalls = { value: 0 };

  const bootstrap = {
    execute: async (): Promise<BootstrapResult> => {
      bootstrapCalls.value += 1;
      if (overrides?.bootstrapFn) return overrides.bootstrapFn();
      return overrides?.bootstrapResult ?? NON_EMPTY_BOOTSTRAP;
    }
  };

  const quotes = {
    refresh: async (codes: readonly StockCode[], options?: RefreshOptions): Promise<QuoteSnapshot> => {
      refreshCalls.value += 1;
      void codes;
      void options;
      if (overrides?.refreshFn) return overrides.refreshFn(codes, options);
      return overrides?.refreshResult ?? NON_EMPTY_SNAPSHOT;
    }
  };

  const scheduler = new QuoteScheduler({ bootstrap, quotes, alarm, action, clock, sink });
  return { scheduler, alarm, action, clock, events, bootstrapCalls, refreshCalls };
}

/** 微任务等待：让出 N 个微任务槽。 */
async function tick(count = 1): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Deferred：用于控制 bootstrap/refresh 何时 resolve。 */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ===== Brief Step 1 Test 1: safety-before-work + exact-after-work =====

test('cycle schedules safety before work and exact alarm after work', async () => {
  const { scheduler, alarm } = createScheduler();
  await scheduler.runQuoteCycle('alarm');
  assert.deepEqual(
    alarm.calls.map((call) => call.kind),
    ['safety', 'exact']
  );
  assert.ok(alarm.calls[0].when <= NOW + 5 * 60_000);
  assert.equal(alarm.calls[1].when, NOW + 30_000);
});

// ===== Brief Step 1 Test 2: ensureAlarm recreates missing alarm =====

test('activation recreates a missing alarm', async () => {
  const { scheduler, alarm } = createScheduler();
  alarm.current = null;
  await scheduler.ensureAlarm();
  assert.equal(alarm.current?.name, 'quote-refresh:v2');
});

// ===== ensureAlarm 不重建已存在的 alarm =====

test('ensureAlarm does not recreate when alarm already exists', async () => {
  const { scheduler, alarm } = createScheduler();
  alarm.current = { name: ALARM_NAME, scheduledTime: NOW + 60_000 };
  await scheduler.ensureAlarm();
  // 不新增 schedule 调用
  assert.equal(alarm.calls.length, 0);
  assert.equal(alarm.current?.scheduledTime, NOW + 60_000);
});

// ===== ensureAlarm 重建的 alarm 是 safety interval =====

test('ensureAlarm schedules safety alarm when missing', async () => {
  const { scheduler, alarm } = createScheduler();
  alarm.current = null;
  await scheduler.ensureAlarm();
  assert.equal(alarm.calls.length, 1);
  assert.equal(alarm.calls[0].name, ALARM_NAME);
  assert.equal(alarm.calls[0].when, NOW + SAFETY_DELAY_MS);
});

// ===== 空 watchlist 清 badge，不调 QuoteService =====

test('empty watchlist clears badge without calling QuoteService', async () => {
  const { scheduler, action, refreshCalls } = createScheduler({
    bootstrapResult: EMPTY_BOOTSTRAP
  });
  await scheduler.runQuoteCycle('alarm');
  assert.equal(action.clearCalls.length, 1);
  assert.equal(action.clearCalls[0].title, '股票提醒助手\n暂无自选股，点击添加');
  assert.equal(action.renderCalls.length, 0);
  assert.equal(refreshCalls.value, 0);
});

// ===== SW 重建（alarm 丢失后 ensureAlarm 恢复）=====

test('SW reconstruction: ensureAlarm restores lost alarm then cycle runs', async () => {
  const { scheduler, alarm } = createScheduler();
  // 模拟 SW 重建：alarm 丢失
  alarm.current = null;
  await scheduler.ensureAlarm();
  assert.equal(alarm.current?.name, ALARM_NAME);
  // alarm 触发后 runQuoteCycle 正常执行
  alarm.reset();
  alarm.current = { name: ALARM_NAME, scheduledTime: NOW }; // alarm 存在
  await scheduler.runQuoteCycle('alarm');
  assert.equal(alarm.calls.length, 2);
  assert.deepEqual(
    alarm.calls.map((c) => c.kind),
    ['safety', 'exact']
  );
});

// ===== 并发 trigger collapse =====

test('concurrent triggers collapse into coalesced cycle', async () => {
  const gate = createDeferred<BootstrapResult>();
  const bootstrapFn = async (): Promise<BootstrapResult> => {
    return gate.promise;
  };
  const { scheduler, alarm, bootstrapCalls } = createScheduler({
    bootstrapFn,
    bootstrapResult: EMPTY_BOOTSTRAP
  });

  // 启动第一个 cycle（阻塞在 bootstrap gate）
  const p1 = scheduler.runQuoteCycle('alarm');
  // 确保第一个 cycle 已开始（safety alarm 已调度）
  await tick();

  // 并发触发第二个 cycle → 应折叠为 pendingRun
  const p2 = scheduler.runQuoteCycle('alarm');

  // 释放 gate
  gate.resolve(EMPTY_BOOTSTRAP);

  await p1;
  await p2;

  // 第一个 cycle (2 calls) + coalesced cycle (2 calls) = 4
  assert.equal(alarm.calls.length, 4);
  assert.deepEqual(
    alarm.calls.map((c) => c.kind),
    ['safety', 'exact', 'safety', 'exact']
  );
  // bootstrap 被调用两次（first + coalesced）
  assert.equal(bootstrapCalls.value, 2);
});

// ===== storage-triggered cycle =====

test('storage-triggered cycle runs with storage-change source', async () => {
  const { scheduler, alarm, action } = createScheduler();
  await scheduler.runQuoteCycle('storage-change');
  assert.deepEqual(
    alarm.calls.map((c) => c.kind),
    ['safety', 'exact']
  );
  // 非空 watchlist → render called
  assert.ok(action.renderCalls.length > 0);
});

// ===== provider failure 不停止调度 =====

test('provider failure does not stop scheduling', async () => {
  const refreshFn = async (): Promise<QuoteSnapshot> => {
    throw new Error('network timeout');
  };
  const { scheduler, alarm, action, events } = createScheduler({
    refreshFn,
    bootstrapResult: NON_EMPTY_BOOTSTRAP
  });
  await scheduler.runQuoteCycle('alarm');
  // safety + exact 都调度了（调度不中断）
  assert.equal(alarm.calls.length, 2);
  assert.deepEqual(
    alarm.calls.map((c) => c.kind),
    ['safety', 'exact']
  );
  // Phase 1 cache render 成功（在 refresh 抛出之前）
  assert.ok(action.renderCalls.length >= 1);
  // 诊断事件包含 update-action-failed
  assert.ok(events.some((e) => e.type === 'update-action-failed' && e.outcome === 'failed'));
});

// ===== cache (bootstrap) failure 不停止调度 =====

test('cache failure does not stop scheduling', async () => {
  const bootstrapFn = async (): Promise<BootstrapResult> => {
    throw new Error('storage read failed');
  };
  const { scheduler, alarm, action, refreshCalls, events } = createScheduler({
    bootstrapFn,
    bootstrapResult: NON_EMPTY_BOOTSTRAP
  });
  await scheduler.runQuoteCycle('alarm');
  // safety + exact 都调度了
  assert.equal(alarm.calls.length, 2);
  assert.deepEqual(
    alarm.calls.map((c) => c.kind),
    ['safety', 'exact']
  );
  // bootstrap 失败 → 无 render/clear，无 refresh
  assert.equal(action.renderCalls.length, 0);
  assert.equal(action.clearCalls.length, 0);
  assert.equal(refreshCalls.value, 0);
  // 诊断事件包含 update-action-failed
  assert.ok(events.some((e) => e.type === 'update-action-failed' && e.outcome === 'failed'));
});

// ===== correlated runId diagnostics =====

test('cycle emits correlated runId diagnostics', async () => {
  const { scheduler, events } = createScheduler();
  await scheduler.runQuoteCycle('alarm');
  const startEvents = events.filter((e) => e.type === 'cycle:start');
  const endEvents = events.filter((e) => e.type === 'cycle:end');
  assert.equal(startEvents.length, 1);
  assert.equal(endEvents.length, 1);
  // start 和 end 共享同一 runId
  assert.equal(startEvents[0].runId, endEvents[0].runId);
  assert.ok(startEvents[0].runId);
  assert.equal(startEvents[0].scope, 'scheduler');
  assert.equal(endEvents[0].scope, 'scheduler');
  assert.equal(endEvents[0].outcome, 'ok');
});

// ===== 多次 cycle 使用不同 runId =====

test('multiple cycles use different runIds', async () => {
  const { scheduler, events } = createScheduler();
  await scheduler.runQuoteCycle('alarm');
  await scheduler.runQuoteCycle('alarm');
  const startEvents = events.filter((e) => e.type === 'cycle:start');
  assert.equal(startEvents.length, 2);
  assert.notEqual(startEvents[0].runId, startEvents[1].runId);
});
