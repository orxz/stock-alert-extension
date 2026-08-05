// tests/unit/application/quote-service.test.ts
// Task 9 — QuoteService：批量 / 并发 / 超时 / deadline / 双源降级 / 缓存 / 退避 / 诊断。
// 覆盖：chunking / concurrency2 / partial / 7d-cache / zero-price /
//       persistent-backoff / 8s-deadline / force / empty / single-flight / diagnostics.
import assert from 'node:assert/strict';
import test from 'node:test';

import { QuoteService } from '../../../src/application/quotes/quote-service.js';
import type { RefreshOptions } from '../../../src/application/quotes/quote-service.js';
import type { QuoteProvider } from '../../../src/application/ports/quote-provider.js';
import type { QuoteCacheRepository } from '../../../src/application/ports/storage.js';
import type { Clock, Cancelable } from '../../../src/application/ports/clock.js';
import type { CancellationToken } from '../../../src/application/ports/cancellation.js';
import type { DiagnosticSink, DiagnosticEvent } from '../../../src/application/ports/diagnostics.js';
import type { StockCode } from '../../../src/domain/brands.js';
import type { Quote, QuoteCacheEntry, QuoteSnapshot } from '../../../src/domain/quote.js';
import { FixedClock } from '../../helpers/fixed-clock.js';
import { FakeSessionState } from '../../helpers/fake-session-state.js';

const NOW = 1_700_000_000;

// ── 工具函数 ──

function sc(value: string): StockCode {
  return value as StockCode;
}

function makeQuote(code: string, price = 100): Quote {
  return {
    code: sc(code),
    name: `Test ${code}`,
    price,
    change: 1,
    changePercent: 0.5,
    amount: 1_000_000
  };
}

function makeCacheEntry(code: string, price: number, fetchedAt: number, provider: 'eastmoney' | 'tencent' = 'eastmoney'): QuoteCacheEntry {
  return {
    cacheVersion: 1,
    code: sc(code),
    provider,
    fetchedAt,
    quote: makeQuote(code, price)
  };
}

function makeCodes(count: number): StockCode[] {
  const codes: StockCode[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(sc(`code${i.toString().padStart(3, '0')}`));
  }
  return codes;
}

/** 微延迟（用于并发测试）。 */
function microDelay(ms = 5): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Mock 缓存 ──

function createMockCache(initial?: Record<string, QuoteCacheEntry>) {
  const data: Record<string, QuoteCacheEntry> = initial
    ? structuredClone(initial)
    : {};
  const cache: Pick<QuoteCacheRepository, 'read' | 'write' | 'delete'> & {
    _data: Record<string, QuoteCacheEntry>;
    writeCount: number;
    deleteCount: number;
  } = {
    _data: data,
    writeCount: 0,
    deleteCount: 0,
    async read(codes: readonly StockCode[]) {
      const result: Record<string, QuoteCacheEntry> = {};
      for (const code of codes) {
        if (code in data) result[code] = structuredClone(data[code]);
      }
      return result;
    },
    async write(entries: Readonly<Record<StockCode, QuoteCacheEntry>>) {
      this.writeCount += 1;
      for (const [code, entry] of Object.entries(entries)) {
        data[code] = structuredClone(entry);
      }
    },
    async delete(codes: readonly StockCode[]) {
      this.deleteCount += 1;
      for (const code of codes) delete data[code as string];
    }
  };
  return cache;
}

// ── Mock providers ──

/** Provider 返回全部 codes 的行情（price=100）。 */
function okProvider(name: 'eastmoney' | 'tencent' = 'eastmine' as 'eastmoney'): {
  provider: QuoteProvider; calls: { value: number; codes: StockCode[][] };
} {
  const calls = { value: 0, codes: [] as StockCode[][] };
  return {
    provider: {
      name: name === 'eastmine' ? 'eastmoney' : name,
      async fetch(codes: readonly StockCode[], _token: CancellationToken) {
        calls.value += 1;
        calls.codes.push([...codes] as StockCode[]);
        const result: Record<string, Quote> = {};
        for (const code of codes) result[code as string] = makeQuote(code as string);
        return result;
      }
    },
    calls
  };
}

/** Provider 总是抛错。 */
function failingProvider(name: 'eastmoney' | 'tencent' = 'eastmoney'): {
  provider: QuoteProvider; calls: { value: number };
} {
  const calls = { value: 0 };
  return {
    provider: {
      name,
      async fetch(_codes: readonly StockCode[], _token: CancellationToken) {
        calls.value += 1;
        throw new Error('network error');
      }
    },
    calls
  };
}

/** Provider 返回空结果（无数据）。 */
function emptyProvider(name: 'eastmoney' | 'tencent' = 'eastmoney'): QuoteProvider {
  return {
    name,
    async fetch(_codes: readonly StockCode[], _token: CancellationToken) {
      return {};
    }
  };
}

/** Provider 返回零价格行情。 */
function zeroPriceProvider(name: 'eastmoney' | 'tencent' = 'eastmoney'): QuoteProvider {
  return {
    name,
    async fetch(codes: readonly StockCode[], _token: CancellationToken) {
      const result: Record<string, Quote> = {};
      for (const code of codes) result[code as string] = makeQuote(code as string, 0);
      return result;
    }
  };
}

/** Provider 返回部分 codes 的行情。 */
function partialProvider(name: 'eastmoney' | 'tencent' = 'eastmoney', fraction = 0.5): QuoteProvider {
  return {
    name,
    async fetch(codes: readonly StockCode[], _token: CancellationToken) {
      const result: Record<string, Quote> = {};
      const count = Math.floor(codes.length * fraction);
      for (let i = 0; i < count; i++) {
        result[codes[i] as string] = makeQuote(codes[i] as string);
      }
      return result;
    }
  };
}

/** 收集诊断 sink。 */
function collectingSink(): { sink: DiagnosticSink; events: DiagnosticEvent[] } {
  const events: DiagnosticEvent[] = [];
  return { sink: { emit: (e) => events.push(e) }, events };
}

// ── createService 工厂 ──

interface ServiceOverrides {
  primary?: QuoteProvider;
  fallback?: QuoteProvider;
  cache?: ReturnType<typeof createMockCache>;
  clock?: Clock;
  session?: FakeSessionState;
  sink?: DiagnosticSink;
}

function createService(overrides: ServiceOverrides = {}): {
  service: QuoteService;
  clock: FixedClock;
  session: FakeSessionState;
  cache: ReturnType<typeof createMockCache>;
  sink: DiagnosticSink;
  events: DiagnosticEvent[];
} {
  const clock = overrides.clock ?? new FixedClock(NOW);
  const session = overrides.session ?? new FakeSessionState();
  const cache = overrides.cache ?? createMockCache();
  const { sink, events } = overrides.sink
    ? { sink: overrides.sink, events: [] as DiagnosticEvent[] }
    : collectingSink();
  const primary = overrides.primary ?? okProvider().provider;
  const fallback = overrides.fallback ?? emptyProvider('tencent');
  const service = new QuoteService(primary, fallback, cache, clock, session, sink);
  return { service, clock: clock as FixedClock, session, cache, sink, events };
}

// ===== chunking: 120 codes → 3 batches =====

test('chunking: 120 codes split into 3 batches of 50/50/20', async () => {
  const { provider, calls } = okProvider();
  const { service } = createService({ primary: provider });
  const codes = makeCodes(120);
  const result = await service.refresh(codes, { force: true });

  assert.equal(calls.value, 3, 'primary called 3 times');
  assert.equal(calls.codes[0].length, 50);
  assert.equal(calls.codes[1].length, 50);
  assert.equal(calls.codes[2].length, 20);
  assert.equal(result.counts.fresh, 120);
});

// ===== concurrency 2: 最多 2 批同时执行 =====

test('concurrency 2: at most 2 batches run simultaneously', async () => {
  let active = 0;
  let maxActive = 0;
  const primary: QuoteProvider = {
    name: 'eastmoney',
    async fetch(codes: readonly StockCode[], _token: CancellationToken) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await microDelay(10);
      active -= 1;
      const result: Record<string, Quote> = {};
      for (const code of codes) result[code as string] = makeQuote(code as string);
      return result;
    }
  };
  const { service } = createService({ primary });
  await service.refresh(makeCodes(150), { force: true });

  assert.ok(maxActive <= 2, `expected maxActive <= 2, got ${maxActive}`);
  assert.equal(maxActive, 2, 'expected exactly 2 concurrent');
});

// ===== partial success: 部分 fresh + 部分 cached =====

test('partial success: primary returns half, rest cached from cache', async () => {
  const codes = makeCodes(10);
  // 预填充后 5 个 code 的缓存
  const initial: Record<string, QuoteCacheEntry> = {};
  for (let i = 5; i < 10; i++) {
    initial[codes[i] as string] = makeCacheEntry(codes[i] as string, 50, NOW - 1000);
  }
  const cache = createMockCache(initial);
  const primary = partialProvider('eastmoney', 0.5);
  const { service } = createService({ primary, cache });
  const result = await service.refresh(codes, { force: true });

  assert.equal(result.counts.fresh, 5);
  assert.equal(result.counts.cached, 5);
  assert.equal(result.counts.missing, 0);
});

// ===== 7 天缓存删除 =====

test('7-day cache: entries older than 7 days are deleted', async () => {
  const cache = createMockCache({
    sh600519: makeCacheEntry('sh600519', 100, NOW - 604_800_001) // 7d + 1ms
  });
  const { service } = createService({ primary: failingProvider(), cache });
  const result = await service.refresh([sc('sh600519')], { force: true });

  assert.equal(result.results.sh600519.status, 'missing');
  assert.equal(cache.deleteCount, 1, 'expired entry deleted');
  assert.ok(!('sh600519' in cache._data), 'entry removed from cache');
});

// ===== 零价格: 不写入缓存 =====

test('zero-price quotes are not written to cache', async () => {
  const cache = createMockCache();
  const { service } = createService({ primary: zeroPriceProvider(), cache });
  const result = await service.refresh([sc('sh600519')], { force: true });

  assert.equal(result.results.sh600519.status, 'missing');
  assert.equal(cache.writeCount, 0, 'no cache writes');
});

// ===== 持久退避跨 Service Worker 重建 =====

test('automatic failures persist backoff across service reconstruction', async () => {
  const session = new FakeSessionState();
  const { provider, calls } = failingProvider();

  // 第一个实例：primary 抛错 → failureCount=1
  const first = createService({ primary: provider, session });
  await first.service.refresh([sc('sh600519')], { force: false });

  // 第二个实例：从 session 恢复退避状态
  const second = createService({ primary: provider, session });
  const result = await second.service.refresh([sc('sh600519')], { force: false });

  assert.equal(result.deferredUntil, NOW + 30_000);
  assert.equal(calls.value, 1, 'primary called only once (by first service)');
});

// ===== 退避序列: 连续失败递增 =====

test('backoff advances through delay sequence on repeated failures', async () => {
  const session = new FakeSessionState();
  const { provider } = failingProvider();
  const { service } = createService({ primary: provider, session });

  // 第一次失败 → failureCount=1, delay=30s
  await service.refresh([sc('sh600519')], { force: true });
  let state = session.peek();
  assert.equal(state.failureCount, 1);
  assert.equal(state.nextAutomaticAttemptAt, NOW + 30_000);

  // 第二次失败 → failureCount=2, delay=120s
  await service.refresh([sc('sh600519')], { force: true });
  state = session.peek();
  assert.equal(state.failureCount, 2);
  assert.equal(state.nextAutomaticAttemptAt, NOW + 120_000);

  // 第三次失败 → failureCount=3, delay=300s
  await service.refresh([sc('sh600519')], { force: true });
  state = session.peek();
  assert.equal(state.failureCount, 3);
  assert.equal(state.nextAutomaticAttemptAt, NOW + 300_000);

  // 第四次失败 → failureCount=4, delay=300s (clamp to last)
  await service.refresh([sc('sh600519')], { force: true });
  state = session.peek();
  assert.equal(state.failureCount, 4);
  assert.equal(state.nextAutomaticAttemptAt, NOW + 300_000);
});

// ===== 成功重置退避 =====

test('fresh > 0 resets backoff to zero', async () => {
  const session = new FakeSessionState();
  session.setState({ failureCount: 3, nextAutomaticAttemptAt: NOW + 300_000 });
  const { service } = createService({ session });

  const result = await service.refresh([sc('sh600519')], { force: true });

  assert.equal(result.counts.fresh, 1);
  const state = session.peek();
  assert.equal(state.failureCount, 0);
  assert.equal(state.nextAutomaticAttemptAt, 0);
});

// ===== force 绕过退避但仍记录结果 =====

test('force bypasses backoff time check but records outcome', async () => {
  const session = new FakeSessionState();
  session.setState({ failureCount: 1, nextAutomaticAttemptAt: NOW + 30_000 });
  const { provider, calls } = okProvider();
  const { service } = createService({ primary: provider, session });

  // force=true 绕过退避
  const result = await service.refresh([sc('sh600519')], { force: true });

  assert.ok(!result.deferredUntil, 'not deferred');
  assert.equal(calls.value, 1, 'primary called despite backoff');
  assert.equal(result.counts.fresh, 1);
  // 成功重置退避
  assert.equal(session.peek().failureCount, 0);
});

// ===== 空请求: 立即返回，不触碰 session =====

test('empty codes return immediately without touching session', async () => {
  const session = new FakeSessionState();
  const { provider, calls } = okProvider();
  const { service } = createService({ primary: provider, session });

  const result = await service.refresh([], { force: false });

  assert.equal(result.counts.fresh, 0);
  assert.equal(result.counts.cached, 0);
  assert.equal(result.counts.missing, 0);
  assert.equal(calls.value, 0, 'primary not called');
  assert.equal(session.readCount, 0, 'session not read');
  assert.equal(session.writeCount, 0, 'session not written');
});

// ===== single-flight: 并发 refresh 不重叠执行 =====

test('single-flight: concurrent refresh calls do not overlap', async () => {
  let active = false;
  let overlap = false;
  const primary: QuoteProvider = {
    name: 'eastmoney',
    async fetch(codes: readonly StockCode[], _token: CancellationToken) {
      if (active) overlap = true;
      active = true;
      await microDelay(10);
      active = false;
      const result: Record<string, Quote> = {};
      for (const code of codes) result[code as string] = makeQuote(code as string);
      return result;
    }
  };
  const { service } = createService({ primary });

  const [r1, r2] = await Promise.all([
    service.refresh([sc('sh600519')], { force: true }),
    service.refresh([sc('sh600519')], { force: true })
  ]);

  assert.ok(!overlap, 'no overlapping provider calls');
  assert.ok(r1.results.sh600519);
  assert.ok(r2.results.sh600519);
});

// ===== 双源降级: primary 缺失的 code 由 fallback 补 =====

test('dual-source: missing codes from primary fetched from fallback', async () => {
  const primary: QuoteProvider = {
    name: 'eastmoney',
    async fetch(codes: readonly StockCode[], _token: CancellationToken) {
      // 只返回第一个 code
      const result: Record<string, Quote> = {};
      result[codes[0] as string] = makeQuote(codes[0] as string);
      return result;
    }
  };
  let fallbackCalled = false;
  let fallbackCodes: string[] = [];
  const fallback: QuoteProvider = {
    name: 'tencent',
    async fetch(codes: readonly StockCode[], _token: CancellationToken) {
      fallbackCalled = true;
      fallbackCodes = codes.map((c) => c as string);
      const result: Record<string, Quote> = {};
      for (const code of codes) result[code as string] = makeQuote(code as string, 200);
      return result;
    }
  };
  const { service } = createService({ primary, fallback });
  const result = await service.refresh([sc('sh600519'), sc('sz000001')], { force: true });

  assert.ok(fallbackCalled, 'fallback was called');
  assert.deepEqual(fallbackCodes, ['sz000001'], 'fallback only for missing code');
  assert.equal(result.results.sh600519.source, 'eastmoney');
  assert.equal(result.results.sz000001.source, 'tencent');
  assert.equal(result.counts.fresh, 2);
});

// ===== 诊断: exactly-once start + end =====

test('diagnostics: each refresh emits exactly one start and one end', async () => {
  const { service, events } = createService();
  await service.refresh([sc('sh600519')], { force: true });

  const starts = events.filter((e) => e.type === 'refresh:start');
  const ends = events.filter((e) => e.type === 'refresh:end');
  assert.equal(starts.length, 1, 'exactly one start');
  assert.equal(ends.length, 1, 'exactly one end');
  assert.equal(ends[0].outcome, 'ok');
});

test('diagnostics: failed refresh emits failed outcome', async () => {
  const { service, events } = createService({ primary: failingProvider() });
  await service.refresh([sc('sh600519')], { force: true });

  const ends = events.filter((e) => e.type === 'refresh:end');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].outcome, 'failed');
});

test('diagnostics: deferred refresh emits degraded outcome', async () => {
  const session = new FakeSessionState();
  session.setState({ failureCount: 1, nextAutomaticAttemptAt: NOW + 30_000 });
  const { service, events } = createService({ session });

  await service.refresh([sc('sh600519')], { force: false });

  const ends = events.filter((e) => e.type === 'refresh:end');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].outcome, 'degraded');
});

// ===== read: 纯缓存读取 =====

test('read returns cached snapshot without remote calls', async () => {
  const cache = createMockCache({
    sh600519: makeCacheEntry('sh600519', 100, NOW - 60_000) // 60s old > 30s freshness
  });
  const { provider, calls } = okProvider();
  const { service } = createService({ primary: provider, cache });

  const result = await service.read([sc('sh600519')]);

  assert.equal(calls.value, 0, 'provider not called');
  assert.equal(result.results.sh600519.status, 'cached'); // 60s > 30s freshness → cached
  assert.equal(result.results.sh600519.quote?.price, 100);
});

test('read with freshnessMs classifies fresh vs cached', async () => {
  const cache = createMockCache({
    sh600519: makeCacheEntry('sh600519', 100, NOW - 500), // 0.5s old
    sz000001: makeCacheEntry('sz000001', 200, NOW - 60_000) // 60s old
  });
  const { service } = createService({ cache });

  const result = await service.read([sc('sh600519'), sc('sz000001')], { freshnessMs: 1000 });

  assert.equal(result.results.sh600519.status, 'fresh'); // 0.5s < 1s
  assert.equal(result.results.sz000001.status, 'cached'); // 60s > 1s
});

// ===== 缓存写入: 只写 price>0 的 fresh 行情 =====

test('cache write: only fresh usable quotes are cached', async () => {
  const cache = createMockCache();
  const primary: QuoteProvider = {
    name: 'eastmoney',
    async fetch(codes: readonly StockCode[], _token: CancellationToken) {
      const result: Record<string, Quote> = {};
      // sh600519 有效，sz000001 零价
      result.sh600519 = makeQuote('sh600519', 100);
      result.sz000001 = makeQuote('sz000001', 0);
      return result;
    }
  };
  const { service } = createService({ primary, cache });
  await service.refresh([sc('sh600519'), sc('sz000001')], { force: true });

  assert.ok('sh600519' in cache._data, 'valid quote cached');
  assert.ok(!('sz000001' in cache._data), 'zero-price quote not cached');
});

// ===== 8s deadline: 返回已完成批 + 缓存 =====

test('overall deadline returns completed batches and cache', async () => {
  const clock = new AdvanceableClock(NOW);
  const session = new FakeSessionState();
  const { sink } = collectingSink();

  // 100 codes
  const codes: StockCode[] = makeCodes(100);
  codes[0] = sc('sh600519'); // batch 1
  codes[50] = sc('sz000001'); // batch 2

  // 预填充 batch 2 codes 的缓存（使 sz000001 为 cached 而非 missing）
  const initial: Record<string, QuoteCacheEntry> = {};
  for (let i = 50; i < 100; i++) {
    initial[codes[i] as string] = makeCacheEntry(codes[i] as string, 50, NOW - 1000);
  }
  const cache = createMockCache(initial);

  // Primary: batch 1 即时返回, batch 2 挂起直到取消
  const primary: QuoteProvider = {
    name: 'eastmoney',
    async fetch(batchCodes: readonly StockCode[], token: CancellationToken) {
      if (batchCodes.includes(sc('sh600519'))) {
        // batch 1: 即时
        const result: Record<string, Quote> = {};
        for (const code of batchCodes) result[code as string] = makeQuote(code as string);
        return result;
      }
      // batch 2: 挂起直到取消
      return new Promise<Record<string, Quote>>((_, reject) => {
        token.onCancel(() => reject(new Error('aborted')));
      });
    }
  };
  // Fallback: 始终挂起
  const fallback: QuoteProvider = {
    name: 'tencent',
    async fetch(_codes: readonly StockCode[], token: CancellationToken) {
      return new Promise<Record<string, Quote>>((_, reject) => {
        token.onCancel(() => reject(new Error('aborted')));
      });
    }
  };

  const service = new QuoteService(primary, fallback, cache, clock, session, sink);

  // 启动 refresh（不 await）
  const refreshPromise = service.refresh(codes, { force: true });

  // 让初始微任务运行（调度 timer、处理 batch 1）
  await new Promise((r) => setTimeout(r, 0));

  // 推进虚拟时间到 8s（触发所有 timer）
  await clock.advanceTo(NOW + 8000);

  const result = await refreshPromise;

  assert.equal(clock.elapsed(), 8_000, 'elapsed should be 8000ms');
  assert.equal(result.results.sh600519.status, 'fresh', 'batch 1 should be fresh');
  assert.equal(result.results.sz000001.status, 'cached', 'batch 2 should be cached');
});

// ===== generation 递增 =====

test('generation increments on each refresh', async () => {
  const { service } = createService();
  const r1 = await service.refresh([sc('sh600519')], { force: true });
  const r2 = await service.refresh([sc('sh600519')], { force: true });
  assert.ok(r2.generation > r1.generation, 'generation should increase');
});

// ===== 退避期内返回 read(freshnessMs:0) 结果 =====

test('backoff-deferred returns cached (not fresh) results', async () => {
  const session = new FakeSessionState();
  session.setState({ failureCount: 1, nextAutomaticAttemptAt: NOW + 30_000 });
  const cache = createMockCache({
    sh600519: makeCacheEntry('sh600519', 100, NOW - 500) // 0.5s old, would be fresh normally
  });
  const { provider, calls } = okProvider();
  const { service } = createService({ primary: provider, session, cache });

  const result = await service.refresh([sc('sh600519')], { force: false });

  assert.equal(calls.value, 0, 'provider not called during backoff');
  assert.equal(result.deferredUntil, NOW + 30_000);
  // freshnessMs=0 → 所有缓存为 cached（非 fresh）
  assert.equal(result.results.sh600519.status, 'cached');
});

// ===== primary 超时后 fallback 补充 =====

test('primary timeout falls back to tencent for missing codes', async () => {
  const cache = createMockCache();
  const primary: QuoteProvider = {
    name: 'eastmoney',
    async fetch(_codes: readonly StockCode[], token: CancellationToken) {
      return new Promise<Record<string, Quote>>((_, reject) => {
        token.onCancel(() => reject(new Error('aborted')));
      });
    }
  };
  const fallback: QuoteProvider = {
    name: 'tencent',
    async fetch(codes: readonly StockCode[], _token: CancellationToken) {
      const result: Record<string, Quote> = {};
      for (const code of codes) result[code as string] = makeQuote(code as string, 200);
      return result;
    }
  };

  // 使用 AdvanceableClock 触发 4s 超时
  const clock = new AdvanceableClock(NOW);
  const session = new FakeSessionState();
  const { sink } = collectingSink();
  const service = new QuoteService(primary, fallback, cache, clock, session, sink);

  const refreshPromise = service.refresh([sc('sh600519')], { force: true });
  await new Promise((r) => setTimeout(r, 0));
  await clock.advanceTo(NOW + 5000); // 超过 4s primary timeout
  const result = await refreshPromise;

  assert.equal(result.results.sh600519.status, 'fresh');
  assert.equal(result.results.sh600519.source, 'tencent');
});

// ── AdvanceableClock: 支持虚拟时间推进和 timer 触发 ──

class AdvanceableClock implements Clock {
  private readonly base: number;
  private time: number;
  private timers: Array<{ fireAt: number; cb: () => void; done: boolean }> = [];

  constructor(baseTime: number) {
    this.base = baseTime;
    this.time = baseTime;
  }

  now(): number {
    return this.time;
  }

  elapsed(): number {
    return this.time - this.base;
  }

  schedule(delayMs: number, callback: () => void): Cancelable {
    const timer = { fireAt: this.time + delayMs, cb: callback, done: false };
    this.timers.push(timer);
    return { cancel: () => { timer.done = true; } };
  }

  /**
   * 推进虚拟时间到 target，沿途按 fireAt 顺序触发未取消的 timer。
   * 每次触发后 yield（setTimeout 0），让微任务/异步链路完成。
   */
  async advanceTo(target: number): Promise<void> {
    for (let iteration = 0; iteration < 100; iteration++) {
      const pending = this.timers
        .filter((t) => !t.done && t.fireAt <= target)
        .sort((a, b) => a.fireAt - b.fireAt);

      if (pending.length === 0) break;

      this.time = Math.max(this.time, pending[0].fireAt);
      pending[0].done = true;
      pending[0].cb();

      // yield 让所有微任务（promise 链 / async 恢复）完成
      await new Promise((r) => setTimeout(r, 0));
    }
    this.time = Math.max(this.time, target);
  }
}
