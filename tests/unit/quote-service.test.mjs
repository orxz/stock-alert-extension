import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const QuoteService = require('../../quote-service.js');
const rootDir = new URL('../../', import.meta.url);

function quote(price) {
  return { name: '股票', price, prevClose: price, open: price, high: price, low: price, volume: 1, amount: 1, change: 0, changePercent: 0 };
}

function memoryCache(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async readQuoteCache(codes) {
      return Object.fromEntries(codes.filter((code) => values[code]).map((code) => [code, structuredClone(values[code])]));
    },
    async writeQuoteCache(entries) { Object.assign(values, structuredClone(entries)); },
    async deleteQuoteCache(codes) { for (const code of codes) delete values[code]; }
  };
}

test('queries Sina only for symbols missing from Eastmoney', async () => {
  const calls = [];
  const transport = {
    enrich: (value) => value,
    async fetchEastmoney(codes) { calls.push(['eastmoney', codes]); return { sh600519: quote(10) }; },
    async fetchSina(codes) { calls.push(['sina', codes]); return { sz000001: quote(20) }; }
  };
  const service = QuoteService.create({ transport, cache: memoryCache(), clock: () => 1000 });
  const snapshot = await service.refresh(['sh600519', 'sz000001']);
  assert.deepEqual(calls, [
    ['eastmoney', ['sh600519', 'sz000001']],
    ['sina', ['sz000001']]
  ]);
  assert.deepEqual(snapshot.counts, { fresh: 2, cached: 0, missing: 0 });
});

test('chunks each provider call at fifty symbols', async () => {
  const calls = [];
  const transport = {
    enrich: (value) => value,
    async fetchEastmoney(codes) { calls.push(codes); return {}; },
    async fetchSina() { return {}; }
  };
  const codes = Array.from({ length: 101 }, (_, index) => `sz${String(index).padStart(6, '0')}`);
  const service = QuoteService.create({ transport, cache: memoryCache(), clock: () => 1000, chunkSize: 50 });
  await service.refresh(codes);
  assert.deepEqual(calls.map((batch) => batch.length), [50, 50, 1]);
});

test('read marks recent cache fresh without calling a provider', async () => {
  let networkCalls = 0;
  const cache = memoryCache({
    sh600519: { cacheVersion: 1, code: 'sh600519', provider: 'eastmoney', fetchedAt: 1000, quote: quote(10) }
  });
  const transport = {
    enrich: (value) => value,
    async fetchEastmoney() { networkCalls += 1; return {}; },
    async fetchSina() { networkCalls += 1; return {}; }
  };
  const service = QuoteService.create({ transport, cache, clock: () => 2000 });
  const snapshot = await service.read(['sh600519'], { freshnessMs: 10000 });
  assert.equal(snapshot.results.sh600519.status, 'fresh');
  assert.equal(snapshot.results.sh600519.source, 'cache');
  assert.equal(networkCalls, 0);
});

test('uses a seven-day cache and rejects an older entry', async () => {
  const now = 604800000 + 1000;
  const cache = memoryCache({
    sh600519: { cacheVersion: 1, code: 'sh600519', provider: 'eastmoney', fetchedAt: 1000, quote: quote(10) },
    sz000001: { cacheVersion: 1, code: 'sz000001', provider: 'eastmoney', fetchedAt: 999, quote: quote(20) }
  });
  const transport = {
    enrich: (value) => value,
    async fetchEastmoney() { throw new Error('offline'); },
    async fetchSina() { throw new Error('offline'); }
  };
  const snapshot = await QuoteService.create({ transport, cache, clock: () => now }).refresh(['sh600519', 'sz000001']);
  assert.equal(snapshot.results.sh600519.status, 'cached');
  assert.equal(snapshot.results.sz000001.status, 'missing');
  assert.equal(cache.values.sz000001, undefined);
});

test('failed refresh keeps a recent cache entry fresh', async () => {
  const now = 10000;
  const cache = memoryCache({
    sh600519: { cacheVersion: 1, code: 'sh600519', provider: 'eastmoney', fetchedAt: 9000, quote: quote(10) }
  });
  const transport = {
    enrich: (value) => value,
    async fetchEastmoney() { throw new Error('offline'); },
    async fetchSina() { throw new Error('offline'); }
  };
  const snapshot = await QuoteService.create({ transport, cache, clock: () => now }).refresh(['sh600519']);
  assert.equal(snapshot.results.sh600519.status, 'fresh');
  assert.equal(snapshot.results.sh600519.source, 'cache');
});

test('reuses an identical in-flight refresh', async () => {
  let resolveRequest;
  const pending = new Promise((resolve) => { resolveRequest = resolve; });
  const transport = {
    enrich: (value) => value,
    async fetchEastmoney() { await pending; return { sh600519: quote(10) }; },
    async fetchSina() { return {}; }
  };
  const service = QuoteService.create({ transport, cache: memoryCache(), clock: () => 1000 });
  const first = service.refresh(['sh600519']);
  const second = service.refresh(['sh600519']);
  assert.equal(first, second);
  resolveRequest();
  await first;
});

test('aborts a provider after the configured timeout', async () => {
  const waitForAbort = (signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const transport = {
    enrich: (value) => value,
    async fetchEastmoney(codes, { signal }) { await waitForAbort(signal); return {}; },
    async fetchSina(codes, { signal }) { await waitForAbort(signal); return {}; }
  };
  const service = QuoteService.create({
    transport,
    cache: memoryCache(),
    clock: () => 1000,
    timeoutMs: 5
  });
  const snapshot = await service.refresh(['sh600519']);
  assert.equal(snapshot.results.sh600519.status, 'missing');
  assert.equal(snapshot.results.sh600519.error, 'timeout');
});

test('uses China market intervals', () => {
  assert.equal(QuoteService.getRefreshIntervalMs(new Date('2026-07-31T01:30:00.000Z'), 'popup'), 10000);
  assert.equal(QuoteService.getRefreshIntervalMs(new Date('2026-07-31T01:30:00.000Z'), 'background'), 30000);
  assert.equal(QuoteService.getRefreshIntervalMs(new Date('2026-08-01T01:30:00.000Z'), 'popup'), 300000);
});

test('runtime entry points load QuoteService after its dependencies', async () => {
  const popup = await readFile(new URL('popup.html', rootDir), 'utf8');
  const background = await readFile(new URL('background.js', rootDir), 'utf8');
  assert.ok(popup.indexOf('src="quotes.js"') < popup.indexOf('src="quote-service.js"'));
  assert.match(background, /importScripts\('stock-utils\.js', 'storage\.js', 'quotes\.js', 'quote-service\.js'\)/);
});

test('automatic failures back off while force allows one retry', async () => {
  let now = 1000;
  let calls = 0;
  const transport = {
    enrich: (value) => value,
    async fetchEastmoney() { calls += 1; return {}; },
    async fetchSina() { calls += 1; return {}; }
  };
  const service = QuoteService.create({ transport, cache: memoryCache(), clock: () => now });
  await service.refresh(['sh600519']);
  assert.equal(calls, 2);
  now = 2000;
  const deferred = await service.refresh(['sh600519']);
  assert.equal(calls, 2);
  assert.equal(deferred.deferredUntil, 31000);
  await service.refresh(['sh600519'], { force: true });
  assert.equal(calls, 4);
});

test('successful refresh resets failure backoff', async () => {
  let now = 1000;
  let available = false;
  let calls = 0;
  const transport = {
    enrich: (value) => value,
    async fetchEastmoney() {
      calls += 1;
      return available ? { sh600519: quote(10) } : {};
    },
    async fetchSina() { calls += 1; return {}; }
  };
  const service = QuoteService.create({ transport, cache: memoryCache(), clock: () => now });
  await service.refresh(['sh600519']);
  available = true;
  now = 2000;
  await service.refresh(['sh600519'], { force: true });
  available = false;
  now = 3000;
  await service.refresh(['sh600519']);
  assert.equal(calls, 5);
});

test('classifies HTTP and malformed provider failures', async () => {
  const cache = memoryCache();
  const httpTransport = {
    enrich: (value) => value,
    async fetchEastmoney() { throw new Error('eastmoney HTTP 500'); },
    async fetchSina() { throw new Error('sina HTTP 503'); }
  };
  const http = await QuoteService.create({ transport: httpTransport, cache, clock: () => 1000 }).refresh(['sh600519']);
  assert.equal(http.results.sh600519.error, 'http');

  const parseTransport = {
    enrich: (value) => value,
    async fetchEastmoney() { throw new Error('malformed payload'); },
    async fetchSina() { throw new Error('parse failed'); }
  };
  const malformed = await QuoteService.create({ transport: parseTransport, cache, clock: () => 1000 }).refresh(['sh600519']);
  assert.equal(malformed.results.sh600519.error, 'parse');
});

test('market activity honors lunch break and inclusive boundaries', () => {
  assert.equal(QuoteService.isChinaMarketActive(new Date('2026-07-31T01:15:00.000Z')), true);
  assert.equal(QuoteService.isChinaMarketActive(new Date('2026-07-31T03:35:00.000Z')), true);
  assert.equal(QuoteService.isChinaMarketActive(new Date('2026-07-31T04:00:00.000Z')), false);
  assert.equal(QuoteService.isChinaMarketActive(new Date('2026-07-31T04:55:00.000Z')), true);
  assert.equal(QuoteService.isChinaMarketActive(new Date('2026-07-31T07:05:00.000Z')), true);
});
