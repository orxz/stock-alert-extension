// tests/unit/application/bootstrap-service.test.ts
// Task 7 — BootstrapService：一次一致快照返回 userData + revision + quoteSnapshot。
import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryStorageArea } from '../../helpers/memory-storage-area.js';
import { FixedClock } from '../../helpers/fixed-clock.js';
import { StorageCoordinator } from '../../../src/infrastructure/storage/storage-coordinator.js';
import { BootstrapService } from '../../../src/application/bootstrap/bootstrap-service.js';
import type { StockCode, QuoteCacheEntry } from '../../../src/domain/index.js';

const NOW = 1_700_000_000;

/** 有效行情缓存条目工厂。 */
function validCacheEntry(code: string, fetchedAt = NOW): QuoteCacheEntry {
  return {
    cacheVersion: 1,
    code: code as StockCode,
    provider: 'eastmoney',
    fetchedAt,
    quote: {
      code: code as StockCode,
      name: 'test',
      price: 100,
      change: 1,
      changePercent: 0.5,
      amount: 999
    }
  };
}

/** 创建带两只股票的 BootstrapService。 */
function createService(cache?: Record<string, unknown>) {
  const initial: Record<string, unknown> = {
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: [
      { code: 'sh600519', name: '贵州茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 },
      { code: 'sz000001', name: '平安银行', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }
    ],
    boardConfig: {}
  };
  if (cache) Object.assign(initial, cache);
  const area = new MemoryStorageArea(initial);
  const clock = new FixedClock(NOW);
  const coordinator = new StorageCoordinator({ area, clock: () => clock.now() });
  const bootstrap = new BootstrapService(coordinator, clock);
  return { bootstrap, coordinator, area, clock };
}

// ===== version =====

test('execute returns version 2.0.0', async () => {
  const { bootstrap } = createService();
  const result = await bootstrap.execute();
  assert.equal(result.version, '2.0.0');
});

// ===== userData =====

test('execute returns userData from readBootstrap', async () => {
  const { bootstrap } = createService();
  const result = await bootstrap.execute();
  assert.equal(result.userData.schemaVersion, 2);
  assert.equal(result.userData.watchlist.length, 2);
  assert.equal(result.userData.watchlist[0].code, 'sh600519');
  assert.equal(result.userData.watchlist[1].code, 'sz000001');
});

// ===== revision =====

test('execute returns revision from readBootstrap', async () => {
  const { bootstrap } = createService();
  const result = await bootstrap.execute();
  assert.ok((result.revision as string).startsWith('sha256:'));
});

test('execute revision matches coordinator readBootstrap revision', async () => {
  const { bootstrap, coordinator } = createService();
  const [serviceResult, coordinatorResult] = await Promise.all([
    bootstrap.execute(),
    coordinator.readBootstrap()
  ]);
  assert.equal(serviceResult.revision, coordinatorResult.revision);
});

// ===== quoteSnapshot (snapshotFromCache) =====

test('execute derives fresh quoteSnapshot from cache', async () => {
  const { bootstrap } = createService({
    'quoteCache:sh600519': validCacheEntry('sh600519'),
    'quoteCache:sz000001': validCacheEntry('sz000001')
  });
  const result = await bootstrap.execute();
  assert.equal(result.quoteSnapshot.counts.fresh, 2);
  assert.equal(result.quoteSnapshot.counts.missing, 0);
  assert.equal(result.quoteSnapshot.results['sh600519' as StockCode].status, 'fresh');
  assert.equal(result.quoteSnapshot.results['sh600519' as StockCode].quote?.price, 100);
});

test('execute marks missing for codes without cache', async () => {
  const { bootstrap } = createService();
  const result = await bootstrap.execute();
  assert.equal(result.quoteSnapshot.counts.missing, 2);
  assert.equal(result.quoteSnapshot.counts.fresh, 0);
  assert.equal(result.quoteSnapshot.results['sh600519' as StockCode].status, 'missing');
});

test('execute marks cached (stale within 7 days) for older entries', async () => {
  const { bootstrap } = createService({
    'quoteCache:sh600519': validCacheEntry('sh600519', NOW - 60_000),
    'quoteCache:sz000001': validCacheEntry('sz000001', NOW - 60_000)
  });
  const result = await bootstrap.execute();
  assert.equal(result.quoteSnapshot.counts.cached, 2);
  assert.equal(result.quoteSnapshot.counts.fresh, 0);
});

test('execute quoteSnapshot uses same clock.now() as BootstrapService', async () => {
  const { bootstrap } = createService({
    'quoteCache:sh600519': validCacheEntry('sh600519', NOW - 29_999)
  });
  const result = await bootstrap.execute();
  // 29999ms < 30000ms freshness threshold → fresh
  assert.equal(result.quoteSnapshot.results['sh600519' as StockCode].status, 'fresh');
});

// ===== 一致性：单次读取快照 =====

test('execute does not refresh quotes (single read critical section)', async () => {
  const { bootstrap } = createService({
    'quoteCache:sh600519': validCacheEntry('sh600519', NOW - 120_000)
  });
  const result = await bootstrap.execute();
  // 120s old → cached (not fresh), confirming no re-fetch occurred
  assert.equal(result.quoteSnapshot.results['sh600519' as StockCode].status, 'cached');
  assert.equal(result.quoteSnapshot.attemptedAt, NOW);
  assert.equal(result.quoteSnapshot.succeededAt, null);
});
