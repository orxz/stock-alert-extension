// tests/unit/storage/coordinator.test.ts
// Task 6 — StorageCoordinator 单队列临界区、乐观并发控制、孤儿清理测试。
import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryStorageArea } from '../../helpers/memory-storage-area.js';
import { StorageCoordinator } from '../../../src/infrastructure/storage/storage-coordinator.js';
import { computeUserDataRevision } from '../../../src/infrastructure/storage/user-data-revision.js';
import type { StockCode, UserDataRevision, QuoteCacheEntry, UserData } from '../../../src/domain/index.js';

const NOW = 1_000_000;

/** 有效行情缓存条目工厂。 */
function validCacheEntry(code: string): QuoteCacheEntry {
  return {
    cacheVersion: 1,
    code: code as StockCode,
    provider: 'eastmoney',
    fetchedAt: NOW,
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

/** 创建一个含单只股票的 Coordinator。 */
function createCoordinatorWithStock(code: string): StorageCoordinator {
  const area = new MemoryStorageArea({
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: [{ code, name: code, groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }],
    boardConfig: {}
  });
  return new StorageCoordinator({ area, clock: () => NOW });
}

/** 创建一个空 watchlist 的 Coordinator。 */
function createEmptyCoordinator(): StorageCoordinator {
  const area = new MemoryStorageArea({
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: [],
    boardConfig: {}
  });
  return new StorageCoordinator({ area, clock: () => NOW });
}

// ===== bootstrap 读放大 =====

/** 记录每次 StorageArea 调用形状的探针。 */
class RecordingStorageArea extends MemoryStorageArea {
  readonly reads: string[] = [];
  readonly keyScans: number[] = [];

  override async get(keys?: readonly string[] | string | null): Promise<Record<string, unknown>> {
    this.reads.push(keys === null || keys === undefined ? 'ALL' : `${[...(typeof keys === 'string' ? [keys] : keys)].length}keys`);
    return super.get(keys);
  }

  async getKeys(): Promise<string[]> {
    this.keyScans.push(1);
    return Object.keys(this.peek());
  }
}

/** 构造含 N 只股票 + N 条缓存的探针 area。 */
function seedWithCaches(count: number): RecordingStorageArea {
  const codes = Array.from({ length: count }, (_, i) => `sh${600000 + i}`);
  const seed: Record<string, unknown> = {
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: codes.map((code) => ({ code, name: code, groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 })),
    boardConfig: {}
  };
  for (const code of codes) seed[`quoteCache:${code}`] = validCacheEntry(code);
  return new RecordingStorageArea(seed);
}

test('readBootstrap does not re-read user data for orphan reconciliation', async () => {
  const area = seedWithCaches(50);
  const coordinator = new StorageCoordinator({ area, clock: () => NOW });
  await coordinator.readBootstrap();

  // 期望：一次读 userData 键 + 一次批量读缓存。孤儿清理必须复用已加载的
  // userData，而不是再走一遍 loadUserData + sanitizeV2。
  const userDataReads = area.reads.filter((r) => r === '6keys');
  assert.equal(userDataReads.length, 1, `userData read once, got ${area.reads.join(',')}`);
});

test('orphan reconciliation lists keys instead of deserializing every cached quote', async () => {
  const area = seedWithCaches(50);
  const coordinator = new StorageCoordinator({ area, clock: () => NOW });
  await coordinator.readBootstrap();

  assert.equal(area.reads.includes('ALL'), false, 'no full-storage value scan');
  assert.ok(area.keyScans.length >= 1, 'used the keys-only primitive');
});

test('orphan reconciliation still deletes cache entries outside the watchlist', async () => {
  const area = seedWithCaches(2);
  await area.set({ 'quoteCache:sz999999': validCacheEntry('sz999999') });
  const coordinator = new StorageCoordinator({ area, clock: () => NOW });
  await coordinator.readBootstrap();

  assert.equal(area.peek()['quoteCache:sz999999'], undefined, 'orphan removed');
  assert.ok(area.peek()['quoteCache:sh600000'], 'member cache retained');
});

test('reconcile falls back to a full scan when getKeys is unavailable', async () => {
  // 老版本 Chrome 没有 storage.getKeys——必须仍能正确清理孤儿。
  const area = new MemoryStorageArea({
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: [{ code: 'sh600519', name: 'x', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }],
    boardConfig: {},
    'quoteCache:sz999999': validCacheEntry('sz999999')
  });
  const coordinator = new StorageCoordinator({ area, clock: () => NOW });
  const removed = await coordinator.reconcileOrphanQuoteCache();

  assert.equal(removed, 1);
  assert.equal(area.peek()['quoteCache:sz999999'], undefined);
});

// ===== readBootstrap =====

test('readBootstrap returns sanitized userData, revision, and empty cache for fresh store', async () => {
  const coordinator = createCoordinatorWithStock('sh600519');
  const snapshot = await coordinator.readBootstrap();
  assert.equal(snapshot.userData.schemaVersion, 2);
  assert.equal(snapshot.userData.watchlist.length, 1);
  assert.equal(snapshot.userData.watchlist[0].code, 'sh600519');
  assert.ok((snapshot.revision as string).startsWith('sha256:'));
  assert.deepEqual(snapshot.quoteCache, {});
});

test('readBootstrap triggers migration for v0 legacy store', async () => {
  const area = new MemoryStorageArea({
    watchlist_legacy: [{ code: '600519', name: '贵州茅台', addedAt: 5 }]
  });
  const coordinator = new StorageCoordinator({ area, clock: () => NOW });
  const snapshot = await coordinator.readBootstrap();
  assert.equal(snapshot.userData.schemaVersion, 2);
  assert.equal(snapshot.userData.watchlist[0].code, 'sh600519');
  assert.equal(snapshot.userData.watchlist[0].name, '贵州茅台');
  assert.ok(area.peek()['migrationBackup:v1.2.1']);
});

// ===== revision 稳定性 =====

test('revision is stable for the same data regardless of key insertion order', async () => {
  const data1 = {
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: [{ code: 'sh600519', name: '茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }],
    boardConfig: { g_a: { viewMode: 'list', sortField: 'manual', sortDirection: 'asc', priceHidden: false }, g_b: { viewMode: 'grid', sortField: 'name', sortDirection: 'desc', priceHidden: true } }
  } as unknown as UserData;
  const data2 = {
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: [{ code: 'sh600519', name: '茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }],
    boardConfig: { g_b: { viewMode: 'grid', sortField: 'name', sortDirection: 'desc', priceHidden: true }, g_a: { viewMode: 'list', sortField: 'manual', sortDirection: 'asc', priceHidden: false } }
  } as unknown as UserData;
  const rev1 = await computeUserDataRevision(data1);
  const rev2 = await computeUserDataRevision(data2);
  assert.equal(rev1, rev2);
});

test('revision changes when content changes', async () => {
  const coordinator = createCoordinatorWithStock('sh600519');
  const rev1 = (await coordinator.readBootstrap()).revision;
  const result = await coordinator.mutate(rev1, (draft) => {
    draft.watchlist = [];
    return null;
  });
  assert.notEqual(result.revision, rev1);
});

// ===== mutate: 乐观并发控制 =====

test('mutate with correct expectedRevision succeeds and writes', async () => {
  const coordinator = createCoordinatorWithStock('sh600519');
  const revision = (await coordinator.readBootstrap()).revision;
  const result = await coordinator.mutate(revision, (draft) => {
    draft.watchlist.push({
      code: 'sz000001' as StockCode,
      name: '平安',
      groupIds: [],
      manualOrder: {},
      pinned: {},
      addedAt: 10
    });
    return 'added';
  });
  assert.equal(result.value, 'added');
  assert.equal(result.userData.watchlist.length, 2);
  const snapshot = await coordinator.readBootstrap();
  assert.equal(snapshot.userData.watchlist.length, 2);
  assert.equal(snapshot.revision, result.revision);
});

test('stale expectedRevision performs no write (CONFLICT)', async () => {
  const coordinator = createCoordinatorWithStock('sh600519');
  await assert.rejects(
    coordinator.mutate('sha256:stale' as UserDataRevision, () => null),
    (error: { code: string }) => error.code === 'CONFLICT'
  );
  assert.equal((await coordinator.readBootstrap()).userData.watchlist.length, 1);
});

test('100 concurrent same-revision mutations: exactly one wins, rest CONFLICT', async () => {
  const coordinator = createEmptyCoordinator();
  const revision = (await coordinator.readBootstrap()).revision;
  const results = await Promise.allSettled(
    Array.from({ length: 100 }, (_, i) =>
      coordinator.mutate(revision, (draft) => {
        const code = `sh600${String(i).padStart(3, '0')}` as StockCode;
        draft.watchlist.push({
          code,
          name: `S${i}`,
          groupIds: [],
          manualOrder: {},
          pinned: {},
          addedAt: i
        });
        return null;
      })
    )
  );
  const ok = results.filter((r) => r.status === 'fulfilled');
  const conflict = results.filter(
    (r) => r.status === 'rejected' && (r.reason as { code: string }).code === 'CONFLICT'
  );
  assert.equal(ok.length, 1);
  assert.equal(conflict.length, 99);
  const final = await coordinator.readBootstrap();
  assert.equal(final.userData.watchlist.length, 1);
});

test('100 sequential chained mutations persist every change (no lost updates)', async () => {
  const coordinator = createEmptyCoordinator();
  let revision = (await coordinator.readBootstrap()).revision;
  for (let i = 0; i < 100; i++) {
    const result = await coordinator.mutate(revision, (draft) => {
      const code = `sh600${String(i).padStart(3, '0')}` as StockCode;
      draft.watchlist.push({
        code,
        name: `S${i}`,
        groupIds: [],
        manualOrder: {},
        pinned: {},
        addedAt: i
      });
      return null;
    });
    revision = result.revision;
  }
  const final = await coordinator.readBootstrap();
  assert.equal(final.userData.watchlist.length, 100);
});

// ===== 单临界区防孤儿 =====

test('one critical section prevents delete versus late cache-write orphans', async () => {
  const coordinator = createCoordinatorWithStock('sh600519');
  const revision = (await coordinator.readBootstrap()).revision;
  await Promise.all([
    coordinator.mutate(revision, (draft) => {
      draft.watchlist = [];
      return null;
    }),
    coordinator.writeQuoteCache({ sh600519: validCacheEntry('sh600519') })
  ]);
  assert.deepEqual(await coordinator.readQuoteCache(['sh600519' as StockCode]), {});
});

test('mutate cleans up quoteCache for removed codes', async () => {
  const coordinator = createCoordinatorWithStock('sh600519');
  await coordinator.writeQuoteCache({ sh600519: validCacheEntry('sh600519') });
  assert.equal(Object.keys(await coordinator.readQuoteCache(['sh600519' as StockCode])).length, 1);

  const revision = (await coordinator.readBootstrap()).revision;
  await coordinator.mutate(revision, (draft) => {
    draft.watchlist = [];
    return null;
  });
  assert.deepEqual(await coordinator.readQuoteCache(['sh600519' as StockCode]), {});
});

// ===== writeQuoteCache 防孤儿 =====

test('writeQuoteCache filters out codes not in watchlist', async () => {
  const coordinator = createCoordinatorWithStock('sh600519');
  await coordinator.writeQuoteCache({
    sh600519: validCacheEntry('sh600519'),
    sz000001: validCacheEntry('sz000001')
  });
  const cache = await coordinator.readQuoteCache(['sh600519' as StockCode, 'sz000001' as StockCode]);
  assert.equal(Object.keys(cache).length, 1);
  assert.ok(cache['sh600519' as StockCode]);
});

// ===== reconcileOrphanQuoteCache =====

test('reconcileOrphanQuoteCache removes orphaned entries and returns count', async () => {
  const area = new MemoryStorageArea({
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: [{ code: 'sh600519', name: '茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }],
    boardConfig: {},
    'quoteCache:sh600519': validCacheEntry('sh600519'),
    'quoteCache:sz000001': validCacheEntry('sz000001'),
    'quoteCache:bj920001': validCacheEntry('bj920001')
  });
  const coordinator = new StorageCoordinator({ area, clock: () => NOW });
  const removed = await coordinator.reconcileOrphanQuoteCache();
  assert.equal(removed, 2);
  const remaining = await coordinator.readQuoteCache([
    'sh600519' as StockCode,
    'sz000001' as StockCode,
    'bj920001' as StockCode
  ]);
  assert.equal(Object.keys(remaining).length, 1);
  assert.ok(remaining['sh600519' as StockCode]);
});

test('reconcileOrphanQuoteCache returns 0 when no orphans', async () => {
  const coordinator = createCoordinatorWithStock('sh600519');
  await coordinator.writeQuoteCache({ sh600519: validCacheEntry('sh600519') });
  const removed = await coordinator.reconcileOrphanQuoteCache();
  assert.equal(removed, 0);
});

// ===== readQuoteCache / deleteQuoteCache =====

test('readQuoteCache returns only structurally valid entries', async () => {
  const area = new MemoryStorageArea({
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: [
      { code: 'sh600519', name: 'A', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 },
      { code: 'sz000001', name: 'B', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }
    ],
    boardConfig: {},
    'quoteCache:sh600519': validCacheEntry('sh600519'),
    'quoteCache:sz000001': { cacheVersion: 2, code: 'sz000001' } // invalid version
  });
  const coordinator = new StorageCoordinator({ area, clock: () => NOW });
  const cache = await coordinator.readQuoteCache(['sh600519' as StockCode, 'sz000001' as StockCode]);
  assert.equal(Object.keys(cache).length, 1);
  assert.ok(cache['sh600519' as StockCode]);
});

test('deleteQuoteCache removes specified entries', async () => {
  const coordinator = createCoordinatorWithStock('sh600519');
  await coordinator.writeQuoteCache({ sh600519: validCacheEntry('sh600519') });
  await coordinator.deleteQuoteCache(['sh600519' as StockCode]);
  assert.deepEqual(await coordinator.readQuoteCache(['sh600519' as StockCode]), {});
});

// ===== bootstrap reads cache after migration =====

test('readBootstrap reads existing cache for watchlist codes', async () => {
  const area = new MemoryStorageArea({
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: [{ code: 'sh600519', name: '茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }],
    boardConfig: {},
    'quoteCache:sh600519': validCacheEntry('sh600519')
  });
  const coordinator = new StorageCoordinator({ area, clock: () => NOW });
  const snapshot = await coordinator.readBootstrap();
  assert.ok(snapshot.quoteCache['sh600519' as StockCode]);
});
