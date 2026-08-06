// tests/unit/storage/repositories.test.ts
// Task 6 — UserDataRepository / QuoteCacheRepository 薄包装测试。
import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryStorageArea } from '../../helpers/memory-storage-area.js';
import { StorageCoordinator } from '../../../src/infrastructure/storage/storage-coordinator.js';
import { UserDataRepositoryImpl } from '../../../src/infrastructure/storage/user-data-repository.js';
import { QuoteCacheRepositoryImpl } from '../../../src/infrastructure/storage/quote-cache-repository.js';
import type { StockCode, QuoteCacheEntry } from '../../../src/domain/index.js';

const NOW = 1_000_000;

function validCacheEntry(code: string): QuoteCacheEntry {
  return {
    cacheVersion: 1,
    code: code as StockCode,
    provider: 'eastmoney',
    fetchedAt: NOW,
    quote: { code: code as StockCode, name: 't', price: 1, change: 0, changePercent: 0, amount: 0 }
  };
}

function setup() {
  const area = new MemoryStorageArea({
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: [{ code: 'sh600519', name: '茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }],
    boardConfig: {}
  });
  const coordinator = new StorageCoordinator({ area, clock: () => NOW });
  const userDataRepo = new UserDataRepositoryImpl(coordinator);
  const quoteCacheRepo = new QuoteCacheRepositoryImpl(coordinator);
  return { coordinator, userDataRepo, quoteCacheRepo, area };
}

// ===== UserDataRepository =====

test('UserDataRepository.readBootstrap delegates to coordinator', async () => {
  const { userDataRepo } = setup();
  const snapshot = await userDataRepo.readBootstrap();
  assert.equal(snapshot.userData.watchlist.length, 1);
  assert.ok((snapshot.revision as string).startsWith('sha256:'));
});

test('UserDataRepository.mutate delegates to coordinator with optimistic concurrency', async () => {
  const { userDataRepo } = setup();
  const revision = (await userDataRepo.readBootstrap()).revision;
  const result = await userDataRepo.mutate(revision, (draft) => {
    draft.watchlist.push({
      code: 'sz000001' as StockCode,
      name: '平安',
      groupIds: [],
      manualOrder: {},
      pinned: {},
      addedAt: 10
    });
    return 'ok';
  });
  assert.equal(result.value, 'ok');
  assert.equal(result.userData.watchlist.length, 2);
  assert.notEqual(result.revision, revision);
  // stale revision → CONFLICT
  await assert.rejects(
    userDataRepo.mutate(revision, () => null),
    (error: { code: string }) => error.code === 'CONFLICT'
  );
});

// ===== QuoteCacheRepository =====

test('QuoteCacheRepository.write/read/delete round-trip', async () => {
  const { quoteCacheRepo } = setup();
  await quoteCacheRepo.write({ sh600519: validCacheEntry('sh600519') });
  const read1 = await quoteCacheRepo.read(['sh600519' as StockCode]);
  assert.ok(read1['sh600519' as StockCode]);

  await quoteCacheRepo.delete(['sh600519' as StockCode]);
  const read2 = await quoteCacheRepo.read(['sh600519' as StockCode]);
  assert.deepEqual(read2, {});
});

test('QuoteCacheRepository.write filters orphans (code not in watchlist)', async () => {
  const { quoteCacheRepo } = setup();
  await quoteCacheRepo.write({
    sh600519: validCacheEntry('sh600519'),
    sz000001: validCacheEntry('sz000001')
  });
  const cache = await quoteCacheRepo.read(['sh600519' as StockCode, 'sz000001' as StockCode]);
  assert.equal(Object.keys(cache).length, 1);
});

// ===== 端口兼容：两个仓储共享同一 Coordinator 实例 =====

test('shared coordinator: userData removal cascades to cache cleanup', async () => {
  const { userDataRepo, quoteCacheRepo } = setup();
  await quoteCacheRepo.write({ sh600519: validCacheEntry('sh600519') });
  const revision = (await userDataRepo.readBootstrap()).revision;
  await userDataRepo.mutate(revision, (draft) => {
    draft.watchlist = [];
    return null;
  });
  const cache = await quoteCacheRepo.read(['sh600519' as StockCode]);
  assert.deepEqual(cache, {});
});
