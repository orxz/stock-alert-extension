// tests/unit/application/diagnostic-span.test.ts
// Task 9 — startSpan exactly-once 诊断：success / degraded / abort / cacheError / providerError。
// 每种结果恰好一个 start 和一个 end；end 幂等（多次调用只发射一次）。
import assert from 'node:assert/strict';
import test from 'node:test';

import { startSpan } from '../../../src/application/diagnostics/span.js';
import type { DiagnosticSink, DiagnosticEvent } from '../../../src/application/ports/diagnostics.js';

const NOW = 1_700_000_000;

/** 基础事件模板。 */
const base: DiagnosticEvent = {
  timestamp: NOW,
  version: '2.0.0',
  scope: 'quote',
  type: 'refresh'
};

/** 收集 sink：将所有事件推入数组。 */
function collectingSink(): { sink: DiagnosticSink; events: DiagnosticEvent[] } {
  const events: DiagnosticEvent[] = [];
  return { sink: { emit: (e) => events.push(e) }, events };
}

/** 统计指定 type 后缀的事件数。 */
function countWithType(events: DiagnosticEvent[], suffix: string): number {
  return events.filter((e) => e.type.endsWith(suffix)).length;
}

// ===== success: 恰好一个 start + 一个 end =====

test('span success: exactly one start and one end', () => {
  const { sink, events } = collectingSink();
  const span = startSpan(sink, base);
  span.end({ ...base, outcome: 'ok' });

  assert.equal(countWithType(events, ':start'), 1);
  assert.equal(countWithType(events, ':end'), 1);
  assert.equal(events[0].type, 'refresh:start');
  assert.equal(events[1].type, 'refresh:end');
  assert.equal(events[1].outcome, 'ok');
});

// ===== degraded cache fallback =====

test('span degraded: exactly one start and one end with boundary', () => {
  const { sink, events } = collectingSink();
  const span = startSpan(sink, base);
  span.boundary({ ...base, type: 'cache-fallback', outcome: 'degraded' });
  span.end({ ...base, outcome: 'degraded' });

  assert.equal(countWithType(events, ':start'), 1);
  assert.equal(countWithType(events, ':end'), 1);
  // boundary 事件不以 :start/:end 结尾
  assert.equal(events.filter((e) => e.type === 'cache-fallback').length, 1);
});

// ===== abort =====

test('span abort: exactly one start and one end', () => {
  const { sink, events } = collectingSink();
  const span = startSpan(sink, base);
  span.boundary({ ...base, type: 'aborted' });
  span.end({ ...base, outcome: 'failed', errorCode: 'QUOTE_TIMEOUT' });

  assert.equal(countWithType(events, ':start'), 1);
  assert.equal(countWithType(events, ':end'), 1);
  assert.equal(events[events.length - 1].outcome, 'failed');
  assert.equal(events[events.length - 1].errorCode, 'QUOTE_TIMEOUT');
});

// ===== cache error =====

test('span cacheError: exactly one start and one end', () => {
  const { sink, events } = collectingSink();
  const span = startSpan(sink, base);
  span.boundary({ ...base, type: 'cache-error', errorCode: 'STORAGE_UNAVAILABLE' });
  span.end({ ...base, outcome: 'failed', errorCode: 'STORAGE_UNAVAILABLE' });

  assert.equal(countWithType(events, ':start'), 1);
  assert.equal(countWithType(events, ':end'), 1);
});

// ===== provider error =====

test('span providerError: exactly one start and one end', () => {
  const { sink, events } = collectingSink();
  const span = startSpan(sink, base);
  span.boundary({ ...base, type: 'provider-error', errorCode: 'QUOTE_UNAVAILABLE' });
  span.end({ ...base, outcome: 'failed', errorCode: 'QUOTE_UNAVAILABLE' });

  assert.equal(countWithType(events, ':start'), 1);
  assert.equal(countWithType(events, ':end'), 1);
});

// ===== end 幂等 =====

test('span end is idempotent: multiple calls emit only once', () => {
  const { sink, events } = collectingSink();
  const span = startSpan(sink, base);
  span.end({ ...base, outcome: 'ok' });
  span.end({ ...base, outcome: 'ok' });
  span.end({ ...base, outcome: 'failed' });

  assert.equal(countWithType(events, ':start'), 1);
  assert.equal(countWithType(events, ':end'), 1);
});

// ===== boundary 可多次调用 =====

test('span boundary can be called multiple times', () => {
  const { sink, events } = collectingSink();
  const span = startSpan(sink, base);
  span.boundary({ ...base, type: 'progress', counts: { done: 1 } });
  span.boundary({ ...base, type: 'progress', counts: { done: 2 } });
  span.end({ ...base, outcome: 'ok' });

  assert.equal(events.filter((e) => e.type === 'progress').length, 2);
  assert.equal(countWithType(events, ':start'), 1);
  assert.equal(countWithType(events, ':end'), 1);
});

// ===== 不同 scope 和 type =====

test('span preserves scope and type from start event', () => {
  const { sink, events } = collectingSink();
  const span = startSpan(sink, { ...base, scope: 'storage', type: 'write' });
  span.end({ ...base, scope: 'storage', type: 'write', outcome: 'ok' });

  assert.equal(events[0].type, 'write:start');
  assert.equal(events[0].scope, 'storage');
  assert.equal(events[1].type, 'write:end');
});
