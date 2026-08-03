// tests/contracts/v1.3-golden.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { readWithV13Rules } from '../fixtures/v1.3/reference-reader.mjs';

const names = ['storage-v0', 'storage-v1', 'storage-v2', 'quote-snapshot', 'formatting'];

test('v1.3 golden contracts are complete and versioned', async () => {
  for (const name of names) {
    const value = JSON.parse(await readFile(new URL(`../fixtures/v1.3/${name}.json`, import.meta.url), 'utf8'));
    assert.equal(value.contractVersion, 1);
    assert.equal(value.sourceVersion, '1.3.0');
  }
});

test('readWithV13Rules sanitizes v2 data: g_all filtered, duplicates merged, invalid refs dropped', () => {
  const now = 1_000_000;
  const input = {
    schemaVersion: 2,
    groups: [
      { groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 1 },
      { groupId: 'g_watch', name: '关注', order: 1, isDefault: false, createdAt: 10, updatedAt: 20 },
      { groupId: 'g_dup', name: '重复组', order: 2, isDefault: false },
      { groupId: 'g_dup', name: '重复组-后', order: 3, isDefault: false },
      { name: '无ID' }
    ],
    watchlist: [
      { code: '600519', name: '贵州茅台', groupIds: ['g_all', 'g_watch'], manualOrder: { g_watch: 0 }, pinned: { g_watch: true }, addedAt: 5000 },
      { code: 'sh600519', name: '', groupIds: ['g_dup', 'g_ghost'], manualOrder: { g_dup: 1 }, pinned: { g_ghost: true }, addedAt: 3000 },
      { code: '000001', name: '平安银行', groupIds: ['g_ghost'], addedAt: 7000 },
      { code: 'SZ300750', name: '宁德时代', groupIds: [], addedAt: 8000 },
      { code: 'not-a-code', name: '非法', groupIds: [], addedAt: 100 }
    ],
    boardConfig: { g_watch: { viewMode: 'list', sortField: 'manual', priceHidden: true } }
  };

  const output = readWithV13Rules(input, now);

  assert.equal(output.schemaVersion, 2);
  // 分组：g_all 固定打头、重复 groupId 合并、缺 groupId 的项被过滤
  assert.deepEqual(output.groups, [
    { groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 1 },
    { groupId: 'g_watch', name: '关注', order: 1, isDefault: false, createdAt: 10, updatedAt: 20 },
    { groupId: 'g_dup', name: '重复组', order: 2, isDefault: false, createdAt: now, updatedAt: now }
  ]);
  // g_all 与非法 groupId 引用绝不进入任何股票的 groupIds
  for (const stock of output.watchlist) {
    assert.ok(!stock.groupIds.includes('g_all'), `${stock.code} must not reference g_all`);
    assert.ok(!stock.groupIds.includes('g_ghost'), `${stock.code} must not reference unknown group`);
    assert.ok(stock.groupIds.every((id) => output.groups.some((g) => g.groupId === id)));
  }
  // 重复 code（600519 与 sh600519）合并为一条，且按首次出现的顺序保留
  assert.deepEqual(output.watchlist.map((s) => s.code), ['sh600519', 'sz000001', 'sz300750']);
  const merged = output.watchlist[0];
  assert.equal(merged.name, '贵州茅台');
  assert.deepEqual(merged.groupIds, ['g_watch', 'g_dup']);
  assert.deepEqual(merged.manualOrder, { g_dup: 1, g_watch: 0 });
  assert.deepEqual(merged.pinned, { g_ghost: true, g_watch: true });
  assert.equal(merged.addedAt, 3000);
  // 非法 code 被剔除
  assert.ok(!output.watchlist.some((s) => s.code === 'not-a-code'));
  // boardConfig 无损回读（深拷贝，不共享引用、不改动输入）
  assert.deepEqual(output.boardConfig, { g_watch: { viewMode: 'list', sortField: 'manual', priceHidden: true } });
  assert.notEqual(output.boardConfig, input.boardConfig);
  assert.equal(input.watchlist.length, 5);
});
