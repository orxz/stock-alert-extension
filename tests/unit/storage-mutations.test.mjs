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

test('group lifecycle validates names, reorders, and cleans group metadata', async () => {
  let now = 100;
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
      manualOrder: { g_a: 1 },
      pinned: { g_a: true },
      addedAt: 1
    }],
    boardConfig: { g_a: { viewMode: 'list' } }
  });
  const storage = createStorage({ area, clock: () => now++ });
  const created = await storage.createGroup('B');
  assert.equal(created.groupId, 'g_101');
  await assert.rejects(() => storage.createGroup('B'), /分组名已存在/);
  await assert.rejects(() => storage.renameGroup(created.groupId, 'A'), /分组名已存在/);
  await storage.renameGroup(created.groupId, 'B2');
  await storage.reorderGroups([created.groupId, 'g_a']);
  assert.deepEqual(area.data.groups.map((group) => group.name), ['全部', 'B2', 'A']);
  await assert.rejects(() => storage.deleteGroup('g_all'), /默认分组不可删除/);
  await storage.deleteGroup('g_a');
  assert.deepEqual(area.data.watchlist[0].groupIds, []);
  assert.equal(area.data.watchlist[0].manualOrder.g_a, undefined);
  assert.equal(area.data.watchlist[0].pinned.g_a, undefined);
  assert.equal(area.data.boardConfig.g_a, undefined);
});

test('group creation enforces the twenty-group limit', async () => {
  const groups = [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true }];
  for (let index = 1; index < 20; index += 1) {
    groups.push({ groupId: `g_${index}`, name: `组${index}`, order: index, isDefault: false });
  }
  const area = createStorageArea({ schemaVersion: 2, groups, watchlist: [], boardConfig: {} });
  const storage = createStorage({ area, clock: () => 100 });
  await assert.rejects(() => storage.createGroup('超限'), /分组已达上限/);
});

test('stock lifecycle supports existing additions, local removal, ordering, and pinning', async () => {
  const area = createStorageArea({
    schemaVersion: 2,
    groups: [
      { groupId: 'g_all', name: '全部', order: 0, isDefault: true },
      { groupId: 'g_a', name: 'A', order: 1, isDefault: false },
      { groupId: 'g_b', name: 'B', order: 2, isDefault: false }
    ],
    watchlist: [{
      code: 'sh600519',
      name: '贵州茅台',
      groupIds: ['g_a'],
      manualOrder: {},
      pinned: {},
      addedAt: 1
    }],
    boardConfig: {}
  });
  const storage = createStorage({ area, clock: () => 100 });
  await storage.addStock('sh600519', '贵州茅台', ['g_b']);
  assert.deepEqual(area.data.watchlist[0].groupIds, ['g_a', 'g_b']);
  await storage.setManualOrder('g_all', ['sh600519']);
  await storage.setManualOrder('g_a', { sh600519: 4 });
  assert.deepEqual(area.data.watchlist[0].manualOrder, { g_all: 0, g_a: 4 });
  await storage.togglePin('g_all', 'sh600519');
  assert.equal(area.data.watchlist[0].pinned.g_all, true);
  await storage.togglePin('g_all', 'sh600519');
  assert.equal(area.data.watchlist[0].pinned, undefined);
  await storage.removeStock('sh600519', 'g_a');
  assert.deepEqual(area.data.watchlist[0].groupIds, ['g_b']);
  await storage.removeStock('missing', 'g_all');
});

test('batch removal handles custom and global deletion with cache cleanup', async () => {
  const stock = (code) => ({ code, name: code, groupIds: ['g_a'], manualOrder: { g_a: 0 }, pinned: { g_a: true }, addedAt: 1 });
  const area = createStorageArea({
    schemaVersion: 2,
    groups: [
      { groupId: 'g_all', name: '全部', order: 0, isDefault: true },
      { groupId: 'g_a', name: 'A', order: 1, isDefault: false }
    ],
    watchlist: [stock('sh600519'), stock('sz000001')],
    boardConfig: {},
    'quoteCache:sh600519': { cacheVersion: 1 }
  });
  const storage = createStorage({ area, clock: () => 100 });
  await storage.removeStocksBatch(['sz000001'], 'g_a');
  assert.deepEqual(area.data.watchlist[1].groupIds, []);
  await storage.removeStocksBatch(['sh600519'], 'g_all');
  assert.deepEqual(area.data.watchlist.map((item) => item.code), ['sz000001']);
  assert.equal(area.data['quoteCache:sh600519'], undefined);
});

test('quote cache writes and deletes normalized independent entries', async () => {
  const area = createStorageArea();
  const storage = createStorage({ area, clock: () => 100 });
  await storage.writeQuoteCache({
    sh600519: { provider: 'eastmoney', fetchedAt: 10, quote: { price: 1 } },
    sz000001: { provider: 'sina', fetchedAt: 11, quote: { price: 2 } }
  });
  assert.equal(area.data['quoteCache:sh600519'].cacheVersion, 1);
  assert.equal(area.data['quoteCache:sz000001'].code, 'sz000001');
  await storage.deleteQuoteCache(['600519']);
  assert.equal(area.data['quoteCache:sh600519'], undefined);
  assert.ok(area.data['quoteCache:sz000001']);
});

test('atomic save methods and board reads preserve unrelated fields', async () => {
  const area = createStorageArea({
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true }],
    watchlist: [],
    boardConfig: { g_all: { viewMode: 'list' } }
  });
  const storage = createStorage({ area, clock: () => 100 });
  assert.equal((await storage.getBoardConfig('g_all')).viewMode, 'list');
  assert.equal((await storage.getBoardConfig('g_missing')).sortField, 'manual');
  await storage.saveWatchlist([{ code: 'sh600519', name: '茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 1 }]);
  await storage.saveBoardConfig({ g_all: { sortDirection: 'asc' } });
  assert.equal(area.data.watchlist.length, 1);
  assert.equal(area.data.boardConfig.g_all.sortDirection, 'asc');
});

test('invalid stock codes are rejected and global removal deletes the quote cache', async () => {
  const area = createStorageArea({
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true }],
    watchlist: [],
    boardConfig: {}
  });
  const storage = createStorage({ area, clock: () => 100 });
  await assert.rejects(() => storage.addStock('120001', '无效', []), /股票代码格式不正确/);
  await storage.addStock('600519', '贵州茅台', []);
  area.data['quoteCache:sh600519'] = { cacheVersion: 1 };
  await storage.removeStock('sh600519', 'g_all');
  assert.equal(area.data.watchlist.length, 0);
  assert.equal(area.data['quoteCache:sh600519'], undefined);
});
