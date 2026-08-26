// tests/unit/application/chart-service.test.ts
// v2.2 ChartService：分时/K线加载——single-flight / 超时 / 可用性校验 / 诊断。
import assert from 'node:assert/strict';
import test from 'node:test';

import { ChartService } from '../../../src/application/charts/chart-service.js';
import type { ChartProviderPort, TrendsPayload, KlinePayload } from '../../../src/application/charts/chart-service.js';
import type { StockCode } from '../../../src/domain/brands.js';
import type { TrendPoint, KlineBar, ChartKind, KlinePeriod } from '../../../src/domain/chart.js';
import type { CancellationToken } from '../../../src/application/ports/cancellation.js';
import type { DiagnosticSink, DiagnosticEvent } from '../../../src/application/ports/diagnostics.js';
import type { Clock, Cancelable } from '../../../src/application/ports/clock.js';
import { FixedClock } from '../../helpers/fixed-clock.js';

const NOW = 1_700_000_000;

function sc(value: string): StockCode {
  return value as StockCode;
}

function makeTrends(): readonly TrendPoint[] {
  return [
    { time: NOW, price: 1300, avgPrice: 1300, high: 1300, low: 1300, volume: 1, amount: 1, volumeRatio: 1 },
    { time: NOW + 60_000, price: 1301, avgPrice: 1300.5, high: 1302, low: 1300, volume: 2, amount: 2, volumeRatio: 1.2 }
  ];
}

function makeKlines(): readonly KlineBar[] {
  return [
    { date: '2026-08-25', open: 100, close: 101, high: 102, low: 99, volume: 1, amount: 1, changePercent: 1, turnoverRate: 1 },
    { date: '2026-08-26', open: 101, close: 103, high: 104, low: 100, volume: 2, amount: 2, changePercent: 2, turnoverRate: 2 }
  ];
}

function okProvider(): { provider: ChartProviderPort; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    provider: {
      async fetch(code: StockCode, kind: ChartKind, period: KlinePeriod, _t: CancellationToken) {
        calls.push(`${code}|${kind}|${period}`);
        if (kind === 'trends') {
          const payload: TrendsPayload = { code, name: '贵州茅台', prevClose: 1304, points: makeTrends() };
          return payload;
        }
        const payload: KlinePayload = { code, name: '贵州茅台', bars: makeKlines() };
        return payload;
      }
    }
  };
}

function collectingSink(): { sink: DiagnosticSink; events: DiagnosticEvent[] } {
  const events: DiagnosticEvent[] = [];
  return { sink: { emit: (e) => events.push(e) }, events };
}

function createService(overrides?: { provider?: ChartProviderPort; clock?: Clock }) {
  const { sink, events } = collectingSink();
  const { provider, calls } = overrides?.provider ? { provider: overrides.provider, calls: [] as string[] } : okProvider();
  const clock = overrides?.clock ?? new FixedClock(NOW);
  const service = new ChartService(provider, clock as Clock, sink);
  return { service, clock, calls, events };
}

test('load trends returns flattened ChartData with name/prevClose', async () => {
  const { service } = createService();
  const data = await service.load(sc('sh600519'), 'trends', 'day');
  assert.equal(data.kind, 'trends');
  assert.equal(data.code, 'sh600519');
  assert.equal(data.name, '贵州茅台');
  assert.equal(data.prevClose, 1304);
  assert.equal(data.trends?.length, 2);
  assert.equal(data.fetchedAt, NOW);
});

test('load kline returns bars and no trends field', async () => {
  const { service } = createService();
  const data = await service.load(sc('sh600519'), 'kline', 'week');
  assert.equal(data.kind, 'kline');
  assert.ok(data.klines && data.klines.length === 2);
  assert.equal(data.trends, undefined);
});

test('single-flight: identical code/kind/period merge into one provider call', async () => {
  const { service, calls } = createService();
  await Promise.all([
    service.load(sc('sh600519'), 'trends', 'day'),
    service.load(sc('sh600519'), 'trends', 'day')
  ]);
  assert.equal(calls.length, 1, '同 key 合并');
});

test('different keys fetch separately', async () => {
  const { service, calls } = createService();
  await Promise.all([
    service.load(sc('sh600519'), 'trends', 'day'),
    service.load(sc('sh600519'), 'kline', 'day')
  ]);
  assert.equal(calls.length, 2, 'kind 不同不合并');
});

test('unusable trends (single point) rejects with error', async () => {
  const provider: ChartProviderPort = {
    async fetch(code, _kind, _period) {
      const payload: TrendsPayload = {
        code,
        name: '停牌',
        points: [{ time: NOW, price: 100, avgPrice: 100, high: 100, low: 100, volume: 0, amount: 0, volumeRatio: 0 }]
      };
      return payload;
    }
  };
  const { service } = createService({ provider });
  await assert.rejects(() => service.load(sc('sh600519'), 'trends', 'day'), /trends unavailable/);
});

test('provider failure emits chart/load-failed diagnostic', async () => {
  const provider: ChartProviderPort = {
    async fetch(): Promise<TrendsPayload> {
      throw new Error('HTTP 500');
    }
  };
  const { service, events } = createService({ provider });
  await assert.rejects(() => service.load(sc('sh600519'), 'trends', 'day'));
  const failure = events.find((e) => e.type === 'load-failed');
  assert.ok(failure, 'load-failed 事件');
  assert.equal(failure?.scope, 'chart');
  assert.equal(failure?.outcome, 'failed');
  assert.equal(failure?.reason, 'HTTP 500');
});
