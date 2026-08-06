// tests/unit/storage/migration.test.ts
// Task 6 — schema v0/v1 → v2 迁移与 sanitizeV2 幂等清洗测试。
import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryStorageArea } from '../../helpers/memory-storage-area.js';
import { sanitizeV2, migrateToV2 } from '../../../src/infrastructure/storage/sanitize-v2.js';
import { migrateToV2 as migrateViaService } from '../../../src/infrastructure/storage/migration-service.js';
import {
  SCHEMA_VERSION,
  MIGRATION_BACKUP_KEY,
  DEFAULT_GROUP_ID,
  MAX_GROUPS
} from '../../../src/infrastructure/storage/sanitize-v2.js';

const NOW = 1_000_000;

// ===== sanitizeV2 纯函数测试 =====

test('sanitizeV2 produces valid v2 from v0/v1 fixtures', () => {
  const raw = {
    schemaVersion: 1,
    groups: [
      { groupId: 'g_all', isDefault: true, name: '全部', order: 0 },
      { groupId: 'g_watch', isDefault: false, name: '关注', order: 1, createdAt: 9000, updatedAt: 9500 }
    ],
    watchlist: [
      { code: '600519', name: '贵州茅台', groupIds: ['g_all', 'g_watch'], manualOrder: { g_watch: 0 }, pinned: { g_watch: true }, addedAt: 58000 }
    ],
    boardConfig: { g_watch: { sortField: 'manual', viewMode: 'list' } }
  };
  const result = sanitizeV2(raw, NOW);

  assert.equal(result.schemaVersion, 2);
  // g_all 不出现在任何 stock.groupIds
  for (const stock of result.watchlist) {
    assert.ok(!stock.groupIds.includes('g_all'));
  }
  assert.deepEqual(result.watchlist[0].groupIds, ['g_watch' as never]);
  assert.equal(result.watchlist[0].code, 'sh600519');
  assert.deepEqual(result.groups[0], {
    groupId: 'g_all', name: '全部', order: 0, isDefault: true,
    createdAt: NOW, updatedAt: NOW
  });
});

test('sanitizeV2 merges duplicate codes: union groupIds, existing-priority, min addedAt', () => {
  const raw = {
    groups: [
      { groupId: 'g_all', name: '全部' },
      { groupId: 'g_a', name: 'A' },
      { groupId: 'g_b', name: 'B' }
    ],
    watchlist: [
      { code: '600519', name: '', groupIds: ['g_a'], manualOrder: { g_a: 1 }, pinned: {}, addedAt: 20 },
      { code: 'sh600519', name: '贵州茅台', groupIds: ['g_b'], manualOrder: { g_b: 2 }, pinned: { g_b: true }, addedAt: 10 }
    ],
    boardConfig: {}
  };
  const result = sanitizeV2(raw, NOW);
  assert.equal(result.watchlist.length, 1);
  assert.equal(result.watchlist[0].code, 'sh600519');
  assert.deepEqual([...result.watchlist[0].groupIds].sort(), ['g_a', 'g_b']);
  assert.equal(result.watchlist[0].name, '贵州茅台');
  // existing-priority: {...normalized, ...existing} → existing wins
  assert.deepEqual(result.watchlist[0].manualOrder, { g_a: 1, g_b: 2 });
  assert.equal(result.watchlist[0].addedAt, 10);
});

test('sanitizeV2 caps groups at MAX_GROUPS (1 default + 19 custom)', () => {
  const groups = [{ groupId: 'g_all', name: '全部' }];
  for (let i = 0; i < 25; i++) {
    groups.push({ groupId: `g_${i}`, name: `G${i}` });
  }
  const result = sanitizeV2({ groups, watchlist: [], boardConfig: {} }, NOW);
  assert.equal(result.groups.length, MAX_GROUPS);
  assert.equal(result.groups[0].groupId, 'g_all');
  for (let i = 1; i < MAX_GROUPS; i++) {
    assert.equal(result.groups[i].order, i);
  }
});

test('sanitizeV2 deduplicates groups by groupId keeping first occurrence', () => {
  const result = sanitizeV2({
    groups: [
      { groupId: 'g_all', name: '全部' },
      { groupId: 'g_a', name: 'A' },
      { groupId: 'g_a', name: '重复A' }
    ],
    watchlist: [],
    boardConfig: {}
  }, NOW);
  assert.deepEqual(result.groups.map((g) => g.groupId), ['g_all', 'g_a']);
  assert.equal(result.groups[1].name, 'A');
});

test('sanitizeV2 is idempotent: running twice produces the same result', () => {
  const raw = {
    groups: [{ groupId: 'g_all', name: '全部' }, { groupId: 'g_tech', name: '科技' }],
    watchlist: [{ code: '600519', name: '贵州茅台', groupIds: ['g_tech'], addedAt: 10 }],
    boardConfig: {}
  };
  const first = sanitizeV2(raw, NOW);
  const second = sanitizeV2(first, NOW);
  assert.deepEqual(second, first);
});

test('sanitizeV2 drops invalid stock codes', () => {
  const result = sanitizeV2({
    groups: [{ groupId: 'g_all', name: '全部' }],
    watchlist: [
      { code: 'sh600519', name: '茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 1 },
      { code: 'not-a-code', name: '非法', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 2 }
    ],
    boardConfig: {}
  }, NOW);
  assert.equal(result.watchlist.length, 1);
  assert.equal(result.watchlist[0].code, 'sh600519');
});

test('sanitizeV2 preserves unrelated boardConfig fields (shallow copy, different ref)', () => {
  const boardConfig = { g_watch: { viewMode: 'list', sortField: 'manual', priceHidden: true } };
  const result = sanitizeV2({ groups: [], watchlist: [], boardConfig }, NOW);
  assert.deepEqual(result.boardConfig, boardConfig);
  assert.notEqual(result.boardConfig, boardConfig);
});

test('g_all never appears in any stock.groupIds after sanitizeV2', () => {
  const result = sanitizeV2({
    groups: [{ groupId: 'g_all', name: '全部' }, { groupId: 'g_tech', name: '科技' }],
    watchlist: [
      { code: '600519', name: 'A', groupIds: ['g_all', 'g_tech', 'g_ghost'], addedAt: 1 },
      { code: 'sz000001', name: 'B', groupIds: ['g_all'], addedAt: 2 }
    ],
    boardConfig: {}
  }, NOW);
  for (const stock of result.watchlist) {
    assert.ok(!stock.groupIds.includes('g_all'), `${stock.code} must not reference g_all`);
  }
});

// ===== migrateToV2 测试 =====

test('migrateToV2 writes first backup and does not overwrite on subsequent runs', async () => {
  const area = new MemoryStorageArea({ groups: [], watchlist: [], boardConfig: {} });
  await migrateViaService(area, area.peek(), 100);
  const backup1 = structuredClone(area.peek()[MIGRATION_BACKUP_KEY]);
  assert.ok(backup1);

  await migrateViaService(area, area.peek(), 200);
  assert.deepEqual(area.peek()[MIGRATION_BACKUP_KEY], backup1);
});

test('migrateToV2 restores v0 legacy watchlist into v2 structure', async () => {
  const area = new MemoryStorageArea({
    watchlist_legacy: [
      { code: '600519', name: '贵州茅台', addedAt: 5 },
      'sz000001'
    ]
  });
  const result = await migrateViaService(area, area.peek(), 100);
  assert.equal(result.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.watchlist.length, 2);
  assert.equal(result.watchlist[0].code, 'sh600519');
  assert.equal(result.watchlist[0].name, '贵州茅台');
  assert.equal(result.watchlist[0].addedAt, 5);
  assert.equal(result.watchlist[1].code, 'sz000001');
  assert.equal(result.watchlist[1].name, 'sz000001');
  // legacy stock gets addedAt fallback: now - index*1000
  assert.equal(result.watchlist[1].addedAt, 100 - 1 * 1000);
  assert.ok(area.peek()[MIGRATION_BACKUP_KEY]?.watchlist_legacy);
});

test('migrateToV2 is idempotent: second run produces identical result', async () => {
  const area = new MemoryStorageArea({
    groups: [{ groupId: 'g_all', name: '全部' }],
    watchlist: [{ code: '600519', name: '茅台', groupIds: ['g_all'], addedAt: 10 }],
    boardConfig: {}
  });
  const first = await migrateViaService(area, area.peek(), 100);
  const backupAfterFirst = structuredClone(area.peek()[MIGRATION_BACKUP_KEY]);
  const second = await migrateViaService(area, area.peek(), 200);
  assert.deepEqual(second, first);
  assert.deepEqual(area.peek()[MIGRATION_BACKUP_KEY], backupAfterFirst);
});

test('migrateToV2 removes g_all from groupIds during migration', async () => {
  const area = new MemoryStorageArea({
    groups: [{ groupId: 'g_all', name: '全部' }, { groupId: 'g_tech', name: '科技' }],
    watchlist: [{
      code: '600519', name: '茅台',
      groupIds: ['g_all', 'g_tech', 'g_missing'],
      manualOrder: { g_all: 3 }, pinned: { g_all: true },
      addedAt: 10
    }],
    boardConfig: {}
  });
  const result = await migrateViaService(area, area.peek(), 100);
  assert.deepEqual(result.watchlist[0].groupIds, ['g_tech' as never]);
});

// ===== sanitize-v2 边界分支补测 =====

test('sanitizeV2 handles null/non-object raw input', () => {
  const result = sanitizeV2(null, NOW);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.groups.length, 1); // 仅 g_all
  assert.equal(result.watchlist.length, 0);
});

test('sanitizeV2 handles string raw input', () => {
  const result = sanitizeV2('not-an-object', NOW);
  assert.equal(result.schemaVersion, 2);
});

test('sanitizeV2 uses DEFAULT_GROUP_NAME when g_all has no name', () => {
  const result = sanitizeV2({ groups: [{ groupId: 'g_all' }], watchlist: [], boardConfig: {} }, NOW);
  assert.equal(result.groups[0].name, '全部');
});

test('sanitizeV2 skips non-object items in watchlist', () => {
  const result = sanitizeV2({
    groups: [{ groupId: 'g_all', name: '全部' }],
    watchlist: [null, 'string', 42, { code: 'sh600519', name: '茅台', addedAt: 1 }],
    boardConfig: {}
  }, NOW);
  assert.equal(result.watchlist.length, 1);
  assert.equal(result.watchlist[0].code, 'sh600519');
});

test('sanitizeV2 handles non-array groupIds as empty', () => {
  const result = sanitizeV2({
    groups: [{ groupId: 'g_all', name: '全部' }, { groupId: 'g_tech', name: '科技' }],
    watchlist: [{ code: 'sh600519', name: '茅台', groupIds: 'not-array', addedAt: 1 }],
    boardConfig: {}
  }, NOW);
  assert.deepEqual([...result.watchlist[0].groupIds], []);
});

test('sanitizeV2 handles non-string name as empty', () => {
  const result = sanitizeV2({
    groups: [{ groupId: 'g_all', name: '全部' }],
    watchlist: [{ code: 'sh600519', name: 12345, addedAt: 1 }],
    boardConfig: {}
  }, NOW);
  assert.equal(result.watchlist[0].name, '');
});

test('sanitizeV2 handles non-finite addedAt as NOW', () => {
  const result = sanitizeV2({
    groups: [{ groupId: 'g_all', name: '全部' }],
    watchlist: [{ code: 'sh600519', name: '茅台', addedAt: Infinity }],
    boardConfig: {}
  }, NOW);
  assert.equal(result.watchlist[0].addedAt, NOW);
});
