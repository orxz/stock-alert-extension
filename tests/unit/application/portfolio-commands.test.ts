// tests/unit/application/portfolio-commands.test.ts
// Task 7 — PortfolioCommands：10 个原子最终态写命令，每个调一次 mutate。
// 覆盖正常路径、边界（合并/去重/上限/保护）、冲突（stale revision）、幂等。
import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryStorageArea } from '../../helpers/memory-storage-area.js';
import { FixedClock } from '../../helpers/fixed-clock.js';
import { StorageCoordinator } from '../../../src/infrastructure/storage/storage-coordinator.js';
import { BootstrapService } from '../../../src/application/bootstrap/bootstrap-service.js';
import { PortfolioCommandsImpl } from '../../../src/application/portfolio/commands.js';
import type { StockCode, GroupId, UserDataRevision } from '../../../src/domain/index.js';

const NOW = 1_700_000_000;

/** 创建带两只股票 + 一个自定义分组的完整环境。 */
function createEnv(extra?: Record<string, unknown>) {
  const initial: Record<string, unknown> = {
    schemaVersion: 2,
    groups: [
      { groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 },
      { groupId: 'g_tech', name: '科技', order: 1, isDefault: false, createdAt: 0, updatedAt: 0 }
    ],
    watchlist: [
      { code: 'sh600519', name: '贵州茅台', groupIds: ['g_tech'], manualOrder: {}, pinned: {}, addedAt: 0 },
      { code: 'sz000001', name: '平安银行', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }
    ],
    boardConfig: {}
  };
  if (extra) Object.assign(initial, extra);
  const area = new MemoryStorageArea(initial);
  const clock = new FixedClock(NOW);
  const coordinator = new StorageCoordinator({ area, clock: () => clock.now() });
  const bootstrap = new BootstrapService(coordinator, clock);
  const commands = new PortfolioCommandsImpl(coordinator, clock);
  return { bootstrap, commands, coordinator, area, clock };
}

/** 获取当前 revision（通过 bootstrap）。 */
async function getRevision(bootstrap: BootstrapService): Promise<UserDataRevision> {
  return (await bootstrap.execute()).revision;
}

// ============================================================
// Brief Step 1 逐字测试
// ============================================================

test('setPinned atomically writes final pin and ordered codes', async () => {
  const { bootstrap, commands } = createEnv();
  const before = await bootstrap.execute();
  const result = await commands.setPinned({
    expectedRevision: before.revision,
    groupId: 'g_all' as GroupId, code: 'sh600519' as StockCode, pinned: true,
    orderedCodes: ['sh600519' as StockCode, 'sz000001' as StockCode]
  });
  const stock = result.userData.watchlist.find((item) => item.code === 'sh600519');
  assert.equal(stock?.pinned.g_all, true);
  assert.equal(stock?.manualOrder.g_all, 0);
});

test('setOrder atomically selects manual sort', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.setOrder({
    expectedRevision: rev,
    groupId: 'g_all' as GroupId,
    orderedCodes: ['sh600519' as StockCode, 'sz000001' as StockCode]
  });
  assert.equal(result.userData.boardConfig.g_all.sortField, 'manual');
});

// ============================================================
// addStock
// ============================================================

test('addStock pushes a new stock with clock.now() addedAt', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.addStock({
    expectedRevision: rev,
    code: 'sh601318' as StockCode,
    name: '中国平安',
    groupIds: ['g_tech' as GroupId]
  });
  assert.equal(result.value.code, 'sh601318');
  assert.equal(result.value.addedAt, NOW);
  assert.deepEqual([...result.value.groupIds], ['g_tech']);
  assert.equal(result.userData.watchlist.length, 3);
});

test('addStock normalizes code (bare digits → market prefix)', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.addStock({
    expectedRevision: rev,
    code: '601318' as StockCode,
    name: '中国平安',
    groupIds: []
  });
  assert.equal(result.value.code, 'sh601318');
});

test('addStock merges groupIds (union) for existing code', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  // sh600519 already has ['g_tech']; add with ['g_finance']
  const result = await commands.addStock({
    expectedRevision: rev,
    code: 'sh600519' as StockCode,
    name: '贵州茅台',
    groupIds: ['g_finance' as GroupId]
  });
  assert.deepEqual([...result.value.groupIds].sort(), ['g_finance', 'g_tech']);
  assert.equal(result.userData.watchlist.length, 2); // no duplicate
});

test('addStock updates name only when existing.name is empty', async () => {
  const area = new MemoryStorageArea({
    schemaVersion: 2,
    groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: [{ code: 'sh600519', name: '', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }],
    boardConfig: {}
  });
  const clock = new FixedClock(NOW);
  const coordinator = new StorageCoordinator({ area, clock: () => clock.now() });
  const bootstrap = new BootstrapService(coordinator, clock);
  const commands = new PortfolioCommandsImpl(coordinator, clock);
  const rev = await getRevision(bootstrap);

  const result = await commands.addStock({
    expectedRevision: rev,
    code: 'sh600519' as StockCode,
    name: '贵州茅台',
    groupIds: []
  });
  assert.equal(result.value.name, '贵州茅台');
});

test('addStock does NOT overwrite existing name when non-empty', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.addStock({
    expectedRevision: rev,
    code: 'sh600519' as StockCode,
    name: '错误名称',
    groupIds: []
  });
  assert.equal(result.value.name, '贵州茅台');
});

test('addStock strips g_all from groupIds', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.addStock({
    expectedRevision: rev,
    code: 'sh601318' as StockCode,
    name: '中国平安',
    groupIds: ['g_all' as GroupId, 'g_tech' as GroupId]
  });
  assert.deepEqual([...result.value.groupIds], ['g_tech']);
});

test('addStock with stale revision throws CONFLICT', async () => {
  const { commands } = createEnv();
  await assert.rejects(
    commands.addStock({
      expectedRevision: 'sha256:stale' as UserDataRevision,
      code: 'sh601318' as StockCode,
      name: '中国平安',
      groupIds: []
    }),
    (error: { code: string }) => error.code === 'CONFLICT'
  );
});

// ============================================================
// removeStocks
// ============================================================

test('removeStocks with g_all completely removes from watchlist', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.removeStocks({
    expectedRevision: rev,
    codes: ['sh600519' as StockCode],
    groupId: 'g_all' as GroupId
  });
  assert.equal(result.userData.watchlist.length, 1);
  assert.equal(result.userData.watchlist[0].code, 'sz000001');
});

test('removeStocks with custom group only removes membership', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.removeStocks({
    expectedRevision: rev,
    codes: ['sh600519' as StockCode],
    groupId: 'g_tech' as GroupId
  });
  assert.equal(result.userData.watchlist.length, 2);
  const stock = result.userData.watchlist.find((s) => s.code === 'sh600519');
  assert.deepEqual([...stock!.groupIds], []);
});

test('removeStocks with custom group cleans manualOrder and pinned', async () => {
  const { bootstrap, commands } = createEnv({
    watchlist: [
      { code: 'sh600519', name: '茅台', groupIds: ['g_tech'], manualOrder: { g_tech: 0 }, pinned: { g_tech: true }, addedAt: 0 },
      { code: 'sz000001', name: '平安', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }
    ]
  });
  const rev = await getRevision(bootstrap);
  const result = await commands.removeStocks({
    expectedRevision: rev,
    codes: ['sh600519' as StockCode],
    groupId: 'g_tech' as GroupId
  });
  const stock = result.userData.watchlist.find((s) => s.code === 'sh600519');
  assert.equal('g_tech' in (stock!.manualOrder as object), false);
  assert.equal('g_tech' in (stock!.pinned as object), false);
});

test('removeStocks silently ignores codes not in watchlist', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.removeStocks({
    expectedRevision: rev,
    codes: ['sh999999' as StockCode],
    groupId: 'g_all' as GroupId
  });
  assert.equal(result.userData.watchlist.length, 2);
});

// ============================================================
// moveStocks
// ============================================================

test('moveStocks adds target groupIds and removes fromGroupId', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  // sz000001 has no groups; move from g_all to g_tech
  const result = await commands.moveStocks({
    expectedRevision: rev,
    codes: ['sz000001' as StockCode],
    fromGroupId: 'g_all' as GroupId,
    targetGroupIds: ['g_tech' as GroupId]
  });
  const stock = result.userData.watchlist.find((s) => s.code === 'sz000001');
  assert.deepEqual([...stock!.groupIds], ['g_tech']);
});

test('moveStocks from custom group removes that membership', async () => {
  const { bootstrap, commands } = createEnv({
    groups: [
      { groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 },
      { groupId: 'g_tech', name: '科技', order: 1, isDefault: false, createdAt: 0, updatedAt: 0 },
      { groupId: 'g_new', name: '新组', order: 2, isDefault: false, createdAt: 0, updatedAt: 0 }
    ]
  });
  const rev = await getRevision(bootstrap);
  // sh600519 has ['g_tech']; move from g_tech to g_new
  const result = await commands.moveStocks({
    expectedRevision: rev,
    codes: ['sh600519' as StockCode],
    fromGroupId: 'g_tech' as GroupId,
    targetGroupIds: ['g_new' as GroupId]
  });
  const stock = result.userData.watchlist.find((s) => s.code === 'sh600519');
  assert.deepEqual([...stock!.groupIds], ['g_new']);
});

test('moveStocks strips g_all from targetGroupIds', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.moveStocks({
    expectedRevision: rev,
    codes: ['sz000001' as StockCode],
    fromGroupId: 'g_all' as GroupId,
    targetGroupIds: ['g_all' as GroupId, 'g_tech' as GroupId]
  });
  const stock = result.userData.watchlist.find((s) => s.code === 'sz000001');
  assert.deepEqual([...stock!.groupIds], ['g_tech']);
});

test('moveStocks deduplicates targetGroupIds', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.moveStocks({
    expectedRevision: rev,
    codes: ['sz000001' as StockCode],
    fromGroupId: 'g_all' as GroupId,
    targetGroupIds: ['g_tech' as GroupId, 'g_tech' as GroupId]
  });
  const stock = result.userData.watchlist.find((s) => s.code === 'sz000001');
  assert.deepEqual([...stock!.groupIds], ['g_tech']);
});

// ============================================================
// setPinned
// ============================================================

test('setPinned writes manualOrder for all orderedCodes', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.setPinned({
    expectedRevision: rev,
    groupId: 'g_all' as GroupId,
    code: 'sh600519' as StockCode,
    pinned: true,
    orderedCodes: ['sh600519' as StockCode, 'sz000001' as StockCode]
  });
  const s1 = result.userData.watchlist.find((s) => s.code === 'sh600519');
  const s2 = result.userData.watchlist.find((s) => s.code === 'sz000001');
  assert.equal(s1?.manualOrder.g_all, 0);
  assert.equal(s2?.manualOrder.g_all, 1);
  assert.equal(s1?.pinned.g_all, true);
  assert.equal(s2?.pinned.g_all, undefined);
});

test('setPinned can unpin', async () => {
  const { bootstrap, commands } = createEnv({
    watchlist: [
      { code: 'sh600519', name: '茅台', groupIds: [], manualOrder: { g_all: 0 }, pinned: { g_all: true }, addedAt: 0 },
      { code: 'sz000001', name: '平安', groupIds: [], manualOrder: { g_all: 1 }, pinned: {}, addedAt: 0 }
    ]
  });
  const rev = await getRevision(bootstrap);
  const result = await commands.setPinned({
    expectedRevision: rev,
    groupId: 'g_all' as GroupId,
    code: 'sh600519' as StockCode,
    pinned: false,
    orderedCodes: ['sz000001' as StockCode, 'sh600519' as StockCode]
  });
  const stock = result.userData.watchlist.find((s) => s.code === 'sh600519');
  assert.equal(stock?.pinned.g_all, false);
  assert.equal(stock?.manualOrder.g_all, 1);
});

test('setPinned with incomplete orderedCodes throws VALIDATION_FAILED', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  // Visible set = {sh600519, sz000001}; pass only one → missing sz000001
  await assert.rejects(
    commands.setPinned({
      expectedRevision: rev,
      groupId: 'g_all' as GroupId,
      code: 'sh600519' as StockCode,
      pinned: true,
      orderedCodes: ['sh600519' as StockCode]
    }),
    (error: { code: string }) => error.code === 'VALIDATION_FAILED'
  );
});

test('setPinned with extra orderedCodes throws VALIDATION_FAILED', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  // Visible set = {sh600519, sz000001}; pass three → extra sh601318
  await assert.rejects(
    commands.setPinned({
      expectedRevision: rev,
      groupId: 'g_all' as GroupId,
      code: 'sh600519' as StockCode,
      pinned: true,
      orderedCodes: ['sh600519' as StockCode, 'sz000001' as StockCode, 'sh601318' as StockCode]
    }),
    (error: { code: string }) => error.code === 'VALIDATION_FAILED'
  );
});

test('setPinned with exact orderedCodes for custom group succeeds', async () => {
  // sh600519 is in g_tech; sz000001 is not → visible set for g_tech = {sh600519}
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.setPinned({
    expectedRevision: rev,
    groupId: 'g_tech' as GroupId,
    code: 'sh600519' as StockCode,
    pinned: true,
    orderedCodes: ['sh600519' as StockCode]
  });
  const stock = result.userData.watchlist.find((s) => s.code === 'sh600519');
  assert.equal(stock?.pinned.g_tech, true);
  assert.equal(stock?.manualOrder.g_tech, 0);
});

// ============================================================
// setOrder
// ============================================================

test('setOrder writes manualOrder indices for all orderedCodes', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.setOrder({
    expectedRevision: rev,
    groupId: 'g_all' as GroupId,
    orderedCodes: ['sz000001' as StockCode, 'sh600519' as StockCode]
  });
  const s1 = result.userData.watchlist.find((s) => s.code === 'sh600519');
  const s2 = result.userData.watchlist.find((s) => s.code === 'sz000001');
  assert.equal(s2?.manualOrder.g_all, 0);
  assert.equal(s1?.manualOrder.g_all, 1);
});

test('setOrder creates default boardConfig if missing', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.setOrder({
    expectedRevision: rev,
    groupId: 'g_all' as GroupId,
    orderedCodes: ['sh600519' as StockCode]
  });
  const cfg = result.userData.boardConfig.g_all;
  assert.equal(cfg.sortField, 'manual');
  assert.equal(cfg.viewMode, 'list');
  assert.equal(cfg.sortDirection, 'asc');
  assert.equal(cfg.priceHidden, false);
});

// ============================================================
// createGroup
// ============================================================

test('createGroup pushes new group with caller-supplied groupId', async () => {
  const { bootstrap, commands, clock } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.createGroup({
    expectedRevision: rev,
    groupId: 'g_finance' as GroupId,
    name: '金融'
  });
  assert.equal(result.value.groupId, 'g_finance');
  assert.equal(result.value.name, '金融');
  assert.equal(result.value.isDefault, false);
  assert.equal(result.value.createdAt, NOW);
  assert.equal(result.value.updatedAt, NOW);
  assert.equal(result.userData.groups.length, 3);
});

test('createGroup throws VALIDATION_FAILED at 20 group limit', async () => {
  const groups = [
    { groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 },
    ...Array.from({ length: 19 }, (_, i) => ({
      groupId: `g_${i}`, name: `G${i}`, order: i + 1, isDefault: false, createdAt: 0, updatedAt: 0
    }))
  ];
  const area = new MemoryStorageArea({
    schemaVersion: 2,
    groups,
    watchlist: [],
    boardConfig: {}
  });
  const clock = new FixedClock(NOW);
  const coordinator = new StorageCoordinator({ area, clock: () => clock.now() });
  const bootstrap = new BootstrapService(coordinator, clock);
  const commands = new PortfolioCommandsImpl(coordinator, clock);
  const rev = await getRevision(bootstrap);

  await assert.rejects(
    commands.createGroup({
      expectedRevision: rev,
      groupId: 'g_overflow' as GroupId,
      name: '溢出'
    }),
    (error: { code: string }) => error.code === 'VALIDATION_FAILED'
  );
});

// ============================================================
// renameGroup
// ============================================================

test('renameGroup updates name and updatedAt', async () => {
  const { bootstrap, commands, clock } = createEnv();
  clock.advance(5000);
  const rev = await getRevision(bootstrap);
  const result = await commands.renameGroup({
    expectedRevision: rev,
    groupId: 'g_tech' as GroupId,
    name: '科技股'
  });
  const group = result.userData.groups.find((g) => g.groupId === 'g_tech');
  assert.equal(group?.name, '科技股');
  assert.equal(group?.updatedAt, NOW + 5000);
});

test('renameGroup is no-op for non-existent group', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.renameGroup({
    expectedRevision: rev,
    groupId: 'g_nonexistent' as GroupId,
    name: '不存在'
  });
  assert.equal(result.userData.groups.length, 2);
});

// ============================================================
// deleteGroup
// ============================================================

test('deleteGroup removes group from groups list', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.deleteGroup({
    expectedRevision: rev,
    groupId: 'g_tech' as GroupId
  });
  assert.equal(result.userData.groups.length, 1);
  assert.equal(result.userData.groups[0].groupId, 'g_all');
});

test('deleteGroup cleans stock groupIds/manualOrder/pinned', async () => {
  const { bootstrap, commands } = createEnv({
    watchlist: [
      { code: 'sh600519', name: '茅台', groupIds: ['g_tech'], manualOrder: { g_tech: 0, g_all: 1 }, pinned: { g_tech: true }, addedAt: 0 },
      { code: 'sz000001', name: '平安', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }
    ]
  });
  const rev = await getRevision(bootstrap);
  const result = await commands.deleteGroup({
    expectedRevision: rev,
    groupId: 'g_tech' as GroupId
  });
  const stock = result.userData.watchlist.find((s) => s.code === 'sh600519');
  assert.deepEqual([...stock!.groupIds], []);
  assert.equal('g_tech' in (stock!.manualOrder as object), false);
  assert.equal('g_tech' in (stock!.pinned as object), false);
  assert.equal(stock!.manualOrder.g_all, 1); // g_all preserved
});

test('deleteGroup removes boardConfig key', async () => {
  const { bootstrap, commands } = createEnv({
    boardConfig: { g_tech: { viewMode: 'grid', sortField: 'name', sortDirection: 'desc', priceHidden: true } }
  });
  const rev = await getRevision(bootstrap);
  const result = await commands.deleteGroup({
    expectedRevision: rev,
    groupId: 'g_tech' as GroupId
  });
  assert.equal('g_tech' in result.userData.boardConfig, false);
});

test('deleteGroup throws VALIDATION_FAILED for g_all', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  await assert.rejects(
    commands.deleteGroup({
      expectedRevision: rev,
      groupId: 'g_all' as GroupId
    }),
    (error: { code: string }) => error.code === 'VALIDATION_FAILED'
  );
});

// ============================================================
// setGroupOrder
// ============================================================

test('setGroupOrder reorders groups by orderedGroupIds', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  // Reverse: g_tech first, g_all second — but g_all should still be accessible
  const result = await commands.setGroupOrder({
    expectedRevision: rev,
    orderedGroupIds: ['g_all' as GroupId, 'g_tech' as GroupId]
  });
  // Groups maintain same order but explicit orders assigned
  const allGroup = result.userData.groups.find((g) => g.groupId === 'g_all');
  const techGroup = result.userData.groups.find((g) => g.groupId === 'g_tech');
  assert.equal(allGroup?.order, 0);
  assert.equal(techGroup?.order, 1);
});

test('setGroupOrder assigns new order indices', async () => {
  const area = new MemoryStorageArea({
    schemaVersion: 2,
    groups: [
      { groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 },
      { groupId: 'g_a', name: 'A', order: 1, isDefault: false, createdAt: 0, updatedAt: 0 },
      { groupId: 'g_b', name: 'B', order: 2, isDefault: false, createdAt: 0, updatedAt: 0 },
      { groupId: 'g_c', name: 'C', order: 3, isDefault: false, createdAt: 0, updatedAt: 0 }
    ],
    watchlist: [],
    boardConfig: {}
  });
  const clock = new FixedClock(NOW);
  const coordinator = new StorageCoordinator({ area, clock: () => clock.now() });
  const bootstrap = new BootstrapService(coordinator, clock);
  const commands = new PortfolioCommandsImpl(coordinator, clock);
  const rev = await getRevision(bootstrap);

  const result = await commands.setGroupOrder({
    expectedRevision: rev,
    orderedGroupIds: ['g_all' as GroupId, 'g_c' as GroupId, 'g_b' as GroupId, 'g_a' as GroupId]
  });
  const groups = result.userData.groups;
  assert.equal(groups.find((g) => g.groupId === 'g_all')?.order, 0);
  assert.equal(groups.find((g) => g.groupId === 'g_c')?.order, 1);
  assert.equal(groups.find((g) => g.groupId === 'g_b')?.order, 2);
  assert.equal(groups.find((g) => g.groupId === 'g_a')?.order, 3);
});

// ============================================================
// patchPreferences
// ============================================================

test('patchPreferences merges patch into existing boardConfig', async () => {
  const { bootstrap, commands } = createEnv({
    boardConfig: { g_all: { viewMode: 'list', sortField: 'name', sortDirection: 'asc', priceHidden: false } }
  });
  const rev = await getRevision(bootstrap);
  const result = await commands.patchPreferences({
    expectedRevision: rev,
    groupId: 'g_all' as GroupId,
    patch: { viewMode: 'grid', priceHidden: true }
  });
  assert.equal(result.value.viewMode, 'grid');
  assert.equal(result.value.priceHidden, true);
  assert.equal(result.value.sortField, 'name'); // preserved
  assert.equal(result.value.sortDirection, 'asc'); // preserved
});

test('patchPreferences creates default config if missing', async () => {
  const { bootstrap, commands } = createEnv();
  const rev = await getRevision(bootstrap);
  const result = await commands.patchPreferences({
    expectedRevision: rev,
    groupId: 'g_tech' as GroupId,
    patch: { sortField: 'price' }
  });
  assert.equal(result.value.sortField, 'price');
  assert.equal(result.value.viewMode, 'list'); // default
  assert.equal(result.value.sortDirection, 'asc'); // default
  assert.equal(result.value.priceHidden, false); // default
});

// ============================================================
// 冲突传播
// ============================================================

test('stale revision CONFLICT propagates from all commands', async () => {
  const { commands } = createEnv();
  const stale = 'sha256:stale' as UserDataRevision;

  await assert.rejects(commands.removeStocks({ expectedRevision: stale, codes: [], groupId: 'g_all' as GroupId }), (e: { code: string }) => e.code === 'CONFLICT');
  await assert.rejects(commands.moveStocks({ expectedRevision: stale, codes: [], fromGroupId: 'g_all' as GroupId, targetGroupIds: [] }), (e: { code: string }) => e.code === 'CONFLICT');
  await assert.rejects(commands.setPinned({ expectedRevision: stale, groupId: 'g_all' as GroupId, code: 'sh600519' as StockCode, pinned: true, orderedCodes: [] }), (e: { code: string }) => e.code === 'CONFLICT');
  await assert.rejects(commands.setOrder({ expectedRevision: stale, groupId: 'g_all' as GroupId, orderedCodes: [] }), (e: { code: string }) => e.code === 'CONFLICT');
  await assert.rejects(commands.createGroup({ expectedRevision: stale, groupId: 'g_x' as GroupId, name: 'X' }), (e: { code: string }) => e.code === 'CONFLICT');
  await assert.rejects(commands.renameGroup({ expectedRevision: stale, groupId: 'g_tech' as GroupId, name: 'X' }), (e: { code: string }) => e.code === 'CONFLICT');
  await assert.rejects(commands.deleteGroup({ expectedRevision: stale, groupId: 'g_tech' as GroupId }), (e: { code: string }) => e.code === 'CONFLICT');
  await assert.rejects(commands.setGroupOrder({ expectedRevision: stale, orderedGroupIds: [] }), (e: { code: string }) => e.code === 'CONFLICT');
  await assert.rejects(commands.patchPreferences({ expectedRevision: stale, groupId: 'g_all' as GroupId, patch: {} }), (e: { code: string }) => e.code === 'CONFLICT');
});

// ============================================================
// 链式 mutation：每次用新 revision
// ============================================================

test('chained mutations with fresh revision succeed sequentially', async () => {
  const { bootstrap, commands } = createEnv();
  let rev = await getRevision(bootstrap);

  // add a stock
  let result = await commands.addStock({ expectedRevision: rev, code: 'sh601318' as StockCode, name: '中国平安', groupIds: [] });
  rev = result.revision;
  assert.equal(result.userData.watchlist.length, 3);

  // pin it
  result = await commands.setPinned({
    expectedRevision: rev,
    groupId: 'g_all' as GroupId,
    code: 'sh601318' as StockCode,
    pinned: true,
    orderedCodes: ['sh601318' as StockCode, 'sh600519' as StockCode, 'sz000001' as StockCode]
  });
  rev = result.revision;

  // create a group
  result = await commands.createGroup({ expectedRevision: rev, groupId: 'g_finance' as GroupId, name: '金融' });
  rev = result.revision;
  assert.equal(result.userData.groups.length, 3);

  // patch preferences
  const prefResult = await commands.patchPreferences({
    expectedRevision: rev,
    groupId: 'g_all' as GroupId,
    patch: { viewMode: 'grid' }
  });
  assert.equal(prefResult.value.viewMode, 'grid');
});

// ============================================================
// 无关字段保留
// ============================================================

test('mutation preserves unrelated boardConfig entries', async () => {
  const { bootstrap, commands } = createEnv({
    boardConfig: {
      g_all: { viewMode: 'list', sortField: 'manual', sortDirection: 'asc', priceHidden: false },
      g_tech: { viewMode: 'grid', sortField: 'name', sortDirection: 'desc', priceHidden: true }
    }
  });
  const rev = await getRevision(bootstrap);
  const result = await commands.patchPreferences({
    expectedRevision: rev,
    groupId: 'g_all' as GroupId,
    patch: { priceHidden: true }
  });
  // g_tech should be preserved unchanged
  assert.equal(result.userData.boardConfig.g_tech.viewMode, 'grid');
  assert.equal(result.userData.boardConfig.g_tech.sortField, 'name');
});
