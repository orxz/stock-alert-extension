// tests/unit/storage-migration.test.mjs — schema v1 → v2 迁移（含 v0 legacy）
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createStorageArea } from '../helpers/chrome-mock.mjs';

const require = createRequire(import.meta.url);
global.StockUtils = require('../../stock-utils.js');
const { createStorage, SCHEMA_VERSION } = require('../../storage.js');

test('migrates g_all membership into a computed view and preserves view metadata', async () => {
  const area = createStorageArea({
    groups: [{ groupId: 'g_all', name: '全部' }, { groupId: 'g_tech', name: '科技' }],
    watchlist: [{
      code: '600519',
      name: '贵州茅台',
      groupIds: ['g_all', 'g_tech', 'g_missing'],
      manualOrder: { g_all: 3 },
      pinned: { g_all: true },
      addedAt: 10
    }],
    boardConfig: { g_all: { viewMode: 'grid' } }
  });
  const repository = createStorage({ area, clock: () => 100 });
  const result = await repository.loadAll();
  assert.equal(result.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(result.watchlist[0].groupIds, ['g_tech']);
  assert.equal(result.watchlist[0].manualOrder.g_all, 3);
  assert.equal(result.watchlist[0].pinned.g_all, true);
  assert.ok(area.data['migrationBackup:v1.2.1']);
});

test('migration is idempotent and does not replace the original backup', async () => {
  const area = createStorageArea({ groups: [], watchlist: [], boardConfig: {} });
  let now = 100;
  const repository = createStorage({ area, clock: () => now++ });
  const first = await repository.loadAll();
  const backup = structuredClone(area.data['migrationBackup:v1.2.1']);
  const second = await repository.loadAll();
  assert.deepEqual(second, first);
  assert.deepEqual(area.data['migrationBackup:v1.2.1'], backup);
});

test('duplicate normalized codes are merged without losing custom memberships', async () => {
  const area = createStorageArea({
    groups: [{ groupId: 'g_all', name: '全部' }, { groupId: 'g_a', name: 'A' }, { groupId: 'g_b', name: 'B' }],
    watchlist: [
      { code: '600519', name: '', groupIds: ['g_a'], manualOrder: {}, pinned: {}, addedAt: 20 },
      { code: 'sh600519', name: '贵州茅台', groupIds: ['g_b'], manualOrder: {}, pinned: {}, addedAt: 10 }
    ],
    boardConfig: {}
  });
  const result = await createStorage({ area, clock: () => 100 }).loadAll();
  assert.equal(result.watchlist.length, 1);
  assert.equal(result.watchlist[0].code, 'sh600519');
  assert.deepEqual(result.watchlist[0].groupIds.sort(), ['g_a', 'g_b']);
  assert.equal(result.watchlist[0].name, '贵州茅台');
  assert.equal(result.watchlist[0].addedAt, 10);
});

test('migrates legacy flat watchlist into schema v2 without membership flags', async () => {
  const area = createStorageArea({
    watchlist_legacy: [
      { code: '600519', name: '贵州茅台', addedAt: 5 },
      'sz000001'
    ]
  });
  const repository = createStorage({ area, clock: () => 100 });
  const result = await repository.loadAll();
  assert.equal(result.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.watchlist.length, 2);
  assert.equal(result.watchlist[0].code, 'sh600519');
  assert.deepEqual(result.watchlist[0].groupIds, []);
  assert.ok(result.groups.find((g) => g.groupId === 'g_all'));
  assert.ok(area.data['migrationBackup:v1.2.1']?.watchlist_legacy);
  const second = await repository.loadAll();
  assert.deepEqual(second, result);
});

test('migration keeps only the first occurrence of each custom group', async () => {
  const area = createStorageArea({
    groups: [
      { groupId: 'g_all', name: '全部' },
      { groupId: 'g_a', name: 'A' },
      { groupId: 'g_a', name: '重复 A' }
    ],
    watchlist: [],
    boardConfig: {}
  });
  const result = await createStorage({ area, clock: () => 100 }).loadAll();
  assert.deepEqual(result.groups.map((group) => group.groupId), ['g_all', 'g_a']);
});
