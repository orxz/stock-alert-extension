// tests/unit/background/router.test.ts
// Task 10 — callback Router：return true + exactly-once sendResponse；dispatch 验证
// protocol/request/method/payload 后 await barrier，handler 结果映射为 ok:true，
// 失败映射为 ok:false（AppError 保留 code，非 AppError → INTERNAL，不泄漏 stack）。
import assert from 'node:assert/strict';
import test from 'node:test';

import { createRouter } from '../../../src/background/router.js';
import { createInitializationBarrier } from '../../../src/background/initialization-barrier.js';
import { FixedClock } from '../../helpers/fixed-clock.js';
import type { DiagnosticEvent } from '../../../src/application/ports/diagnostics.js';

/**
 * 测试本地 waitFor：100 次微任务轮询，最终仍未满足则抛出。
 * 生产代码不暴露 settled() 钩子——此处用 setImmediate 让出微任务槽。
 */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('waitFor timeout');
}

/** 空用户数据 / 空行情快照（合法 BootstrapResult 形状）。 */
const EMPTY_USER_DATA = {
  schemaVersion: 2 as const,
  groups: [],
  watchlist: [],
  boardConfig: {}
};
const EMPTY_SNAPSHOT = {
  results: {},
  counts: { fresh: 0, cached: 0, missing: 0 },
  attemptedAt: 1000,
  succeededAt: null,
  generation: 0
};
const BOOTSTRAP_RESULT = {
  version: '2.0.0' as const,
  userData: EMPTY_USER_DATA,
  revision: 'sha256:abc',
  quoteSnapshot: EMPTY_SNAPSHOT
};

/** 构造可覆盖的 mock services。 */
function makeServices(overrides: Record<string, unknown> = {}) {
  const services = {
    bootstrap: {
      execute: async () => BOOTSTRAP_RESULT
    },
    quotes: {
      read: async () => EMPTY_SNAPSHOT,
      refresh: async () => EMPTY_SNAPSHOT
    },
    search: { search: async () => [] },
    portfolio: {
      addStock: async () => ({ value: null, userData: EMPTY_USER_DATA, revision: 'sha256:new' }),
      removeStocks: async () => ({ value: null, userData: EMPTY_USER_DATA, revision: 'sha256:new' }),
      moveStocks: async () => ({ value: null, userData: EMPTY_USER_DATA, revision: 'sha256:new' }),
      setPinned: async () => ({ value: null, userData: EMPTY_USER_DATA, revision: 'sha256:new' }),
      setOrder: async () => ({ value: null, userData: EMPTY_USER_DATA, revision: 'sha256:new' }),
      createGroup: async () => ({ value: null, userData: EMPTY_USER_DATA, revision: 'sha256:new' }),
      renameGroup: async () => ({ value: null, userData: EMPTY_USER_DATA, revision: 'sha256:new' }),
      deleteGroup: async () => ({ value: null, userData: EMPTY_USER_DATA, revision: 'sha256:new' }),
      setGroupOrder: async () => ({ value: null, userData: EMPTY_USER_DATA, revision: 'sha256:new' }),
      patchPreferences: async () => ({ value: null, userData: EMPTY_USER_DATA, revision: 'sha256:new' })
    },
    ...overrides
  };
  return services;
}

/** 构造 router + 依赖，注入可覆盖的 services 与可选 barrier/sink。 */
function makeRouter(options: { services?: ReturnType<typeof makeServices>; sink?: { emit(event: DiagnosticEvent): void } } = {}) {
  const events: DiagnosticEvent[] = [];
  const sink = options.sink ?? { emit: (e: DiagnosticEvent) => events.push(e) };
  const clock = new FixedClock(1000);
  const services = options.services ?? makeServices();
  const barrier = createInitializationBarrier(async () => services);
  const router = createRouter({ barrier, sink, clock });
  return { router, services, events, sink, clock, barrier };
}

const BOOTSTRAP_REQUEST = { protocol: 2, requestId: 'r1', method: 'app:bootstrap', payload: {} };

// ===== exactly-once + return true =====

test('router returns true and invokes sendResponse exactly once', async () => {
  const { router } = makeRouter();
  const responses: unknown[] = [];
  const returned = router.handle(
    BOOTSTRAP_REQUEST,
    {},
    (value) => responses.push(value)
  );
  assert.equal(returned, true);
  await waitFor(() => responses.length === 1);
  assert.equal(responses.length, 1);
});

test('successful bootstrap response carries ok:true with data', async () => {
  const { router } = makeRouter();
  const responses: unknown[] = [];
  router.handle(BOOTSTRAP_REQUEST, {}, (value) => responses.push(value));
  await waitFor(() => responses.length === 1);
  const response = responses[0] as { protocol: number; requestId: string; ok: boolean; data: unknown };
  assert.equal(response.protocol, 2);
  assert.equal(response.requestId, 'r1');
  assert.equal(response.ok, true);
  assert.equal(response.data, BOOTSTRAP_RESULT);
});

test('sendResponse is never called more than once even on concurrent resolution', async () => {
  const { router } = makeRouter();
  const responses: unknown[] = [];
  router.handle(BOOTSTRAP_REQUEST, {}, (value) => responses.push(value));
  router.handle(BOOTSTRAP_REQUEST, {}, (value) => responses.push(value));
  await waitFor(() => responses.length === 2);
  assert.equal(responses.length, 2);
});

// ===== protocol mismatch =====

test('protocol mismatch returns PROTOCOL_MISMATCH', async () => {
  const { router } = makeRouter();
  const responses: unknown[] = [];
  router.handle({ protocol: 1, requestId: 'r1', method: 'app:bootstrap', payload: {} }, {}, (v) => responses.push(v));
  await waitFor(() => responses.length === 1);
  const response = responses[0] as { ok: boolean; error: { code: string } };
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PROTOCOL_MISMATCH');
});

test('non-object request returns PROTOCOL_MISMATCH', async () => {
  const { router } = makeRouter();
  const responses: unknown[] = [];
  router.handle('not-an-object', {}, (v) => responses.push(v));
  await waitFor(() => responses.length === 1);
  const response = responses[0] as { ok: boolean; error: { code: string } };
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PROTOCOL_MISMATCH');
});

test('missing requestId returns PROTOCOL_MISMATCH', async () => {
  const { router } = makeRouter();
  const responses: unknown[] = [];
  router.handle({ protocol: 2, method: 'app:bootstrap', payload: {} }, {}, (v) => responses.push(v));
  await waitFor(() => responses.length === 1);
  const response = responses[0] as { ok: boolean; error: { code: string } };
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PROTOCOL_MISMATCH');
});

// ===== unknown method =====

test('unknown method returns UNKNOWN_METHOD', async () => {
  const { router } = makeRouter();
  const responses: unknown[] = [];
  router.handle({ protocol: 2, requestId: 'r1', method: 'nope', payload: {} }, {}, (v) => responses.push(v));
  await waitFor(() => responses.length === 1);
  const response = responses[0] as { ok: boolean; error: { code: string } };
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'UNKNOWN_METHOD');
});

// ===== invalid payload =====

test('invalid payload returns INVALID_PAYLOAD', async () => {
  const { router } = makeRouter();
  const responses: unknown[] = [];
  router.handle(
    { protocol: 2, requestId: 'r1', method: 'quote:refresh', payload: { codes: ['sh600519'], force: 'not-a-bool' } },
    {},
    (v) => responses.push(v)
  );
  await waitFor(() => responses.length === 1);
  const response = responses[0] as { ok: boolean; error: { code: string } };
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'INVALID_PAYLOAD');
});

// ===== handler sync throw =====

test('handler synchronous throw maps to error response without stack leak', async () => {
  const services = makeServices({
    bootstrap: { execute: () => { throw new Error('boom-sync'); } }
  });
  const { router } = makeRouter({ services });
  const responses: unknown[] = [];
  router.handle(BOOTSTRAP_REQUEST, {}, (v) => responses.push(v));
  await waitFor(() => responses.length === 1);
  const response = responses[0] as { ok: boolean; error: { code: string; message: string; retryable: boolean } };
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'INTERNAL');
  assert.equal(response.error.retryable, false);
  assert.doesNotMatch(response.error.message, /boom-sync/);
});

// ===== handler async reject =====

test('handler async reject maps to error response', async () => {
  const services = makeServices({
    bootstrap: { execute: async () => { throw new Error('boom-async'); } }
  });
  const { router } = makeRouter({ services });
  const responses: unknown[] = [];
  router.handle(BOOTSTRAP_REQUEST, {}, (v) => responses.push(v));
  await waitFor(() => responses.length === 1);
  const response = responses[0] as { ok: boolean; error: { code: string; retryable: boolean } };
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'INTERNAL');
  assert.equal(response.error.retryable, false);
});

// ===== AppError preserved =====

test('AppError thrown by service preserves its code and retryable', async () => {
  const appError = { code: 'STORAGE_UNAVAILABLE' as const, message: '存储不可用', retryable: true };
  const services = makeServices({
    bootstrap: { execute: async () => { throw appError; } }
  });
  const { router } = makeRouter({ services });
  const responses: unknown[] = [];
  router.handle(BOOTSTRAP_REQUEST, {}, (v) => responses.push(v));
  await waitFor(() => responses.length === 1);
  const response = responses[0] as { ok: boolean; error: { code: string; message: string; retryable: boolean } };
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'STORAGE_UNAVAILABLE');
  assert.equal(response.error.message, '存储不可用');
  assert.equal(response.error.retryable, true);
});

// ===== init reject → retry =====

test('initialization reject returns error then next event retries', async () => {
  let initCalls = 0;
  const barrier = createInitializationBarrier(async () => {
    initCalls += 1;
    if (initCalls === 1) throw new Error('storage unavailable');
    return makeServices();
  });
  const events: DiagnosticEvent[] = [];
  const sink = { emit: (e: DiagnosticEvent) => events.push(e) };
  const clock = new FixedClock(1000);
  const router = createRouter({ barrier, sink, clock });

  // 第一次请求：barrier 初始化失败 → 错误响应
  const responses1: unknown[] = [];
  router.handle(BOOTSTRAP_REQUEST, {}, (v) => responses1.push(v));
  await waitFor(() => responses1.length === 1);
  const errResp = responses1[0] as { ok: boolean; error: { code: string } };
  assert.equal(errResp.ok, false);
  assert.equal(errResp.error.code, 'INTERNAL');

  // 第二次请求：barrier 重试初始化成功 → ok 响应
  const responses2: unknown[] = [];
  router.handle({ protocol: 2, requestId: 'r2', method: 'app:bootstrap', payload: {} }, {}, (v) => responses2.push(v));
  await waitFor(() => responses2.length === 1);
  const okResp = responses2[0] as { ok: boolean };
  assert.equal(okResp.ok, true);
  assert.equal(initCalls, 2);
});

// ===== concurrent init =====

test('concurrent requests during initialization share one attempt and both resolve', async () => {
  let initCalls = 0;
  let resolveInit!: (value: unknown) => void;
  const pending = new Promise((resolve) => { resolveInit = resolve; });
  const barrier = createInitializationBarrier(async () => {
    initCalls += 1;
    return pending as Promise<ReturnType<typeof makeServices>>;
  });
  const events: DiagnosticEvent[] = [];
  const sink = { emit: (e: DiagnosticEvent) => events.push(e) };
  const clock = new FixedClock(1000);
  const router = createRouter({ barrier, sink, clock });

  const responses: unknown[] = [];
  router.handle(BOOTSTRAP_REQUEST, {}, (v) => responses.push(v));
  router.handle({ protocol: 2, requestId: 'r2', method: 'app:bootstrap', payload: {} }, {}, (v) => responses.push(v));

  // 初始化尚未完成，两个请求都在等待同一个 attempt。
  assert.equal(initCalls, 1);
  resolveInit(makeServices());
  await waitFor(() => responses.length === 2);
  assert.equal(responses.length, 2);
  assert.equal((responses[0] as { ok: boolean }).ok, true);
  assert.equal((responses[1] as { ok: boolean }).ok, true);
  assert.equal(initCalls, 1);
});

// ===== diagnostics span =====

test('router emits rpc dispatch start/end spans', async () => {
  const { router, events } = makeRouter();
  const responses: unknown[] = [];
  router.handle(BOOTSTRAP_REQUEST, {}, (v) => responses.push(v));
  await waitFor(() => responses.length === 1);
  const types = events.map((e) => e.type);
  assert.ok(types.includes('dispatch:start'));
  assert.ok(types.includes('dispatch:end'));
  const endEvent = events.find((e) => e.type === 'dispatch:end') as DiagnosticEvent | undefined;
  assert.equal(endEvent?.scope, 'rpc');
  assert.equal(endEvent?.outcome, 'ok');
});

test('failed dispatch emits span with failed outcome and errorCode', async () => {
  const services = makeServices({
    bootstrap: { execute: async () => { throw { code: 'STORAGE_UNAVAILABLE', message: 'x', retryable: true }; } }
  });
  const { router, events } = makeRouter({ services });
  const responses: unknown[] = [];
  router.handle(BOOTSTRAP_REQUEST, {}, (v) => responses.push(v));
  await waitFor(() => responses.length === 1);
  const endEvent = events.find((e) => e.type === 'dispatch:end') as DiagnosticEvent | undefined;
  assert.equal(endEvent?.outcome, 'failed');
  assert.equal(endEvent?.errorCode, 'STORAGE_UNAVAILABLE');
});
