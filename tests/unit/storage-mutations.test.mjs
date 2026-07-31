// tests/unit/storage-mutations.test.mjs — 串行化写入与按股行情缓存
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createStorageArea } from '../helpers/chrome-mock.mjs';

const require = createRequire(import.meta.url);
global.StockUtils = require('../../stock-utils.js');
const { createStorage } = require('../../storage.js');

test('concurrent board patches are serialized without lost updates', async () => {
  const area = createStorageArea({
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true }],
    watchlist: [],
    boardConfig: { g_all: { viewMode: 'grid' } }
  }, { delayMs: 2 });
  const storage = createStorage({ area, clock: () => 100 });
  await Promise.all([
    storage.saveBoardConfigForGroup('g_all', { sortField: 'price' }),
    storage.saveBoardConfigForGroup('g_all', { sortDirection: 'asc' })
  ]);
  assert.deepEqual(area.data.boardConfig.g_all, {
    viewMode: 'grid',
    sortField: 'price',
    sortDirection: 'asc'
  });
});

test('stock added to a custom group is still global without storing g_all', async () => {
  const area = createStorageArea({
    schemaVersion: 2,
    groups: [
      { groupId: 'g_all', name: '全部', order: 0, isDefault: true },
      { groupId: 'g_tech', name: '科技', order: 1, isDefault: false }
    ],
    watchlist: [],
    boardConfig: {}
  });
  const storage = createStorage({ area, clock: () => 100 });
  await storage.addStock('sh600519', '贵州茅台', ['g_tech']);
  assert.deepEqual(area.data.watchlist[0].groupIds, ['g_tech']);
  assert.equal(StockUtils.getStocksForGroup(area.data.watchlist, 'g_all').length, 1);
});

test('quote cache keys are independent and corrupted entries are ignored', async () => {
  const area = createStorageArea({
    'quoteCache:sh600519': { cacheVersion: 1, code: 'sh600519', provider: 'eastmoney', fetchedAt: 10, quote: { price: 1 } },
    'quoteCache:sz000001': { broken: true }
  });
  const storage = createStorage({ area, clock: () => 100 });
  const result = await storage.readQuoteCache(['sh600519', 'sz000001']);
  assert.equal(result.sh600519.quote.price, 1);
  assert.equal(result.sz000001, undefined);
});

test('atomic save methods are serialized without lost updates', async () => {
  const area = createStorageArea({
    schemaVersion: 2,
    groups: [],
    watchlist: [],
    boardConfig: {}
  }, { delayMs: 2 });
  const storage = createStorage({ area, clock: () => 100 });
  await Promise.all([
    storage.saveGroups([{ groupId: 'g_a', name: 'A', order: 0, isDefault: false }]),
    storage.saveGroups([{ groupId: 'g_b', name: 'B', order: 0, isDefault: false }])
  ]);
  assert.equal(area.data.groups[0].groupId, 'g_b');
});

test('addStock normalizes the code and ignores unknown group ids', async () => {
  const area = createStorageArea({
    schemaVersion: 2,
    groups: [
      { groupId: 'g_all', name: '全部', order: 0, isDefault: true },
      { groupId: 'g_tech', name: '科技', order: 1, isDefault: false }
    ],
    watchlist: [],
    boardConfig: {}
  });
  const storage = createStorage({ area, clock: () => 100 });
  await storage.addStock('600519', '贵州茅台', ['g_all', 'g_tech', 'g_missing']);
  assert.equal(area.data.watchlist[0].code, 'sh600519');
  assert.deepEqual(area.data.watchlist[0].groupIds, ['g_tech']);
});

test('moving a stock to g_all removes only the source custom membership', async () => {
  const area = createStorageArea({
    schemaVersion: 2,
    groups: [
      { groupId: 'g_all', name: '全部', order: 0, isDefault: true },
      { groupId: 'g_a', name: 'A', order: 1, isDefault: false }
    ],
    watchlist: [{
      code: 'sh600519',
      name: '贵州茅台',
      groupIds: ['g_a'],
      manualOrder: { g_a: 0 },
      pinned: { g_a: true },
      addedAt: 1
    }],
    boardConfig: {}
  });
  const storage = createStorage({ area, clock: () => 100 });
  await storage.moveStocksToGroups(['sh600519'], 'g_a', ['g_all']);
  assert.deepEqual(area.data.watchlist[0].groupIds, []);
  assert.equal(area.data.watchlist[0].manualOrder.g_a, undefined);
  assert.equal(area.data.watchlist[0].pinned.g_a, undefined);
});

test('saveBoardConfigForGroup returns the merged durable config', async () => {
  const area = createStorageArea({
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true }],
    watchlist: [],
    boardConfig: { g_all: { viewMode: 'grid' } }
  });
  const storage = createStorage({ area, clock: () => 100 });
  const saved = await storage.saveBoardConfigForGroup('g_all', { sortField: 'price' });
  assert.deepEqual(saved, { viewMode: 'grid', sortField: 'price' });
  assert.deepEqual(area.data.boardConfig.g_all, saved);
});
