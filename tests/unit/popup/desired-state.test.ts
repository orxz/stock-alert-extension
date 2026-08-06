// tests/unit/popup/desired-state.test.ts
// Task 13 Step 4 — desiredState 10 个 predicate 各 true/false 穷尽测试。
import assert from 'node:assert/strict';
import test from 'node:test';

import { desiredState } from '../../../src/popup/commands/desired-state.js';
import type { UserData, Stock, Group, GroupId, StockCode } from '../../../src/domain/index.js';

const G_ALL = 'g_all' as GroupId;
const G1 = 'g1' as GroupId;
const G2 = 'g2' as GroupId;
const CODE_A = 'sh600519' as StockCode;
const CODE_B = 'sz000001' as StockCode;

function mkStock(code: StockCode, name: string, extra?: Partial<Stock>): Stock {
  return Object.assign({ code, name, groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }, extra || {});
}

function mkGroup(id: GroupId, name: string, order: number): Group {
  return { groupId: id, name, order, isDefault: id === G_ALL, createdAt: 0, updatedAt: 0 };
}

function userData(groups: readonly Group[], watchlist: readonly Stock[], extra?: Partial<UserData>): UserData {
  return Object.assign({ schemaVersion: 2 as const, groups, watchlist, boardConfig: {} }, extra || {});
}

// ===== stock:add =====

test('stock:add satisfied when code exists with all requested groupIds', () => {
  const stock = mkStock(CODE_A, 'A', { groupIds: [G1] });
  assert.equal(desiredState['stock:add']({ code: CODE_A, name: 'A', groupIds: [G1] } as never, userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, 'G1', 1)], [stock])), true);
});

test('stock:add not satisfied when code missing', () => {
  assert.equal(desiredState['stock:add']({ code: CODE_A, name: 'A', groupIds: [G1] } as never, userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, 'G1', 1)], [])), false);
});

test('stock:add not satisfied when a groupId is absent', () => {
  const stock = mkStock(CODE_A, 'A', { groupIds: [G1] });
  assert.equal(desiredState['stock:add']({ code: CODE_A, name: 'A', groupIds: [G1, G2] } as never, userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, 'G1', 1), mkGroup(G2, 'G2', 2)], [stock])), false);
});

// ===== stock:remove =====

test('stock:remove satisfied for g_all when stock gone entirely', () => {
  assert.equal(desiredState['stock:remove']({ codes: [CODE_A], groupId: G_ALL } as never, userData([mkGroup(G_ALL, '全部', 0)], [])), true);
});

test('stock:remove not satisfied for g_all when stock still present', () => {
  const stock = mkStock(CODE_A, 'A');
  assert.equal(desiredState['stock:remove']({ codes: [CODE_A], groupId: G_ALL } as never, userData([mkGroup(G_ALL, '全部', 0)], [stock])), false);
});

test('stock:remove satisfied for specific group when groupId removed from stock', () => {
  const stock = mkStock(CODE_A, 'A', { groupIds: [] });
  assert.equal(desiredState['stock:remove']({ codes: [CODE_A], groupId: G1 } as never, userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, 'G1', 1)], [stock])), true);
});

test('stock:remove not satisfied when stock still in group', () => {
  const stock = mkStock(CODE_A, 'A', { groupIds: [G1] });
  assert.equal(desiredState['stock:remove']({ codes: [CODE_A], groupId: G1 } as never, userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, 'G1', 1)], [stock])), false);
});

// ===== stock:move =====

test('stock:move satisfied when left source and joined all targets', () => {
  const stock = mkStock(CODE_A, 'A', { groupIds: [G2] });
  assert.equal(desiredState['stock:move']({ codes: [CODE_A], fromGroupId: G1, targetGroupIds: [G2] } as never, userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, 'G1', 1), mkGroup(G2, 'G2', 2)], [stock])), true);
});

test('stock:move not satisfied when still in source group', () => {
  const stock = mkStock(CODE_A, 'A', { groupIds: [G1, G2] });
  assert.equal(desiredState['stock:move']({ codes: [CODE_A], fromGroupId: G1, targetGroupIds: [G2] } as never, userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, 'G1', 1), mkGroup(G2, 'G2', 2)], [stock])), false);
});

test('stock:move satisfied when from g_all and joined all targets', () => {
  const stock = mkStock(CODE_A, 'A', { groupIds: [G2] });
  assert.equal(desiredState['stock:move']({ codes: [CODE_A], fromGroupId: G_ALL, targetGroupIds: [G2] } as never, userData([mkGroup(G_ALL, '全部', 0), mkGroup(G2, 'G2', 2)], [stock])), true);
});

test('stock:move not satisfied when missing a target', () => {
  const stock = mkStock(CODE_A, 'A', { groupIds: [G1] });
  assert.equal(desiredState['stock:move']({ codes: [CODE_A], fromGroupId: G_ALL, targetGroupIds: [G1, G2] } as never, userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, 'G1', 1), mkGroup(G2, 'G2', 2)], [stock])), false);
});

// ===== stock:setPinned =====

test('stock:setPinned satisfied when pinned flag and manualOrder match', () => {
  const stock = mkStock(CODE_A, 'A', { pinned: { [G_ALL]: true }, manualOrder: { [G_ALL]: 0 } });
  assert.equal(desiredState['stock:setPinned']({ groupId: G_ALL, code: CODE_A, pinned: true, orderedCodes: [CODE_A] } as never, userData([mkGroup(G_ALL, '全部', 0)], [stock])), true);
});

test('stock:setPinned not satisfied when pinned flag differs', () => {
  const stock = mkStock(CODE_A, 'A', { pinned: { [G_ALL]: false }, manualOrder: { [G_ALL]: 0 } });
  assert.equal(desiredState['stock:setPinned']({ groupId: G_ALL, code: CODE_A, pinned: true, orderedCodes: [CODE_A] } as never, userData([mkGroup(G_ALL, '全部', 0)], [stock])), false);
});

test('stock:setPinned not satisfied when manualOrder differs', () => {
  const stockA = mkStock(CODE_A, 'A', { pinned: { [G_ALL]: true }, manualOrder: { [G_ALL]: 1 } });
  const stockB = mkStock(CODE_B, 'B', { pinned: { [G_ALL]: false }, manualOrder: { [G_ALL]: 0 } });
  assert.equal(desiredState['stock:setPinned']({ groupId: G_ALL, code: CODE_A, pinned: true, orderedCodes: [CODE_A, CODE_B] } as never, userData([mkGroup(G_ALL, '全部', 0)], [stockA, stockB])), false);
});

// ===== stock:setOrder =====

test('stock:setOrder satisfied when manualOrder matches and sortField is manual', () => {
  const stockA = mkStock(CODE_A, 'A', { manualOrder: { [G_ALL]: 0 } });
  const stockB = mkStock(CODE_B, 'B', { manualOrder: { [G_ALL]: 1 } });
  const data = userData([mkGroup(G_ALL, '全部', 0)], [stockA, stockB], { boardConfig: { [G_ALL]: { viewMode: 'list', sortField: 'manual', sortDirection: 'asc', priceHidden: false } } });
  assert.equal(desiredState['stock:setOrder']({ groupId: G_ALL, orderedCodes: [CODE_A, CODE_B] } as never, data), true);
});

test('stock:setOrder not satisfied when sortField is not manual', () => {
  const stockA = mkStock(CODE_A, 'A', { manualOrder: { [G_ALL]: 0 } });
  const data = userData([mkGroup(G_ALL, '全部', 0)], [stockA], { boardConfig: { [G_ALL]: { viewMode: 'list', sortField: 'addedAt', sortDirection: 'asc', priceHidden: false } } });
  assert.equal(desiredState['stock:setOrder']({ groupId: G_ALL, orderedCodes: [CODE_A] } as never, data), false);
});

test('stock:setOrder not satisfied when manualOrder differs', () => {
  const stockA = mkStock(CODE_A, 'A', { manualOrder: { [G_ALL]: 5 } });
  const data = userData([mkGroup(G_ALL, '全部', 0)], [stockA], { boardConfig: { [G_ALL]: { viewMode: 'list', sortField: 'manual', sortDirection: 'asc', priceHidden: false } } });
  assert.equal(desiredState['stock:setOrder']({ groupId: G_ALL, orderedCodes: [CODE_A] } as never, data), false);
});

// ===== group:create =====

test('group:create satisfied when group exists with matching id and name', () => {
  const data = userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, '我的', 1)], []);
  assert.equal(desiredState['group:create']({ groupId: G1, name: '我的' } as never, data), true);
});

test('group:create not satisfied when name differs', () => {
  const data = userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, '旧', 1)], []);
  assert.equal(desiredState['group:create']({ groupId: G1, name: '新' } as never, data), false);
});

test('group:create not satisfied when group absent', () => {
  const data = userData([mkGroup(G_ALL, '全部', 0)], []);
  assert.equal(desiredState['group:create']({ groupId: G1, name: '我的' } as never, data), false);
});

// ===== group:rename =====

test('group:rename satisfied when name matches', () => {
  const data = userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, '新名称', 1)], []);
  assert.equal(desiredState['group:rename']({ groupId: G1, name: '新名称' } as never, data), true);
});

test('group:rename not satisfied when name still old', () => {
  const data = userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, '旧名称', 1)], []);
  assert.equal(desiredState['group:rename']({ groupId: G1, name: '新名称' } as never, data), false);
});

// ===== group:delete =====

test('group:delete satisfied when group/boardConfig/watchlist all cleaned', () => {
  const data = userData([mkGroup(G_ALL, '全部', 0)], []);
  assert.equal(desiredState['group:delete']({ groupId: G1 } as never, data), true);
});

test('group:delete not satisfied when group still present', () => {
  const data = userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, 'G1', 1)], []);
  assert.equal(desiredState['group:delete']({ groupId: G1 } as never, data), false);
});

test('group:delete not satisfied when boardConfig still has entry', () => {
  const data = userData([mkGroup(G_ALL, '全部', 0)], [], { boardConfig: { [G1]: { viewMode: 'list', sortField: 'manual', sortDirection: 'asc', priceHidden: false } } });
  assert.equal(desiredState['group:delete']({ groupId: G1 } as never, data), false);
});

test('group:delete not satisfied when a stock still references the group', () => {
  const stock = mkStock(CODE_A, 'A', { groupIds: [G1] });
  const data = userData([mkGroup(G_ALL, '全部', 0)], [stock]);
  assert.equal(desiredState['group:delete']({ groupId: G1 } as never, data), false);
});

// ===== group:setOrder =====

test('group:setOrder satisfied when groups order matches payload', () => {
  const data = userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, 'G1', 1), mkGroup(G2, 'G2', 2)], []);
  assert.equal(desiredState['group:setOrder']({ orderedGroupIds: [G_ALL, G1, G2] } as never, data), true);
});

test('group:setOrder not satisfied when order differs', () => {
  const data = userData([mkGroup(G_ALL, '全部', 0), mkGroup(G1, 'G1', 1), mkGroup(G2, 'G2', 2)], []);
  assert.equal(desiredState['group:setOrder']({ orderedGroupIds: [G_ALL, G2, G1] } as never, data), false);
});

// ===== preferences:patch =====

test('preferences:patch satisfied when all patched fields match', () => {
  const data = userData([mkGroup(G_ALL, '全部', 0)], [], { boardConfig: { [G_ALL]: { viewMode: 'grid', sortField: 'price', sortDirection: 'desc', priceHidden: true } } });
  assert.equal(desiredState['preferences:patch']({ groupId: G_ALL, patch: { viewMode: 'grid', priceHidden: true } } as never, data), true);
});

test('preferences:patch not satisfied when a patched field differs', () => {
  const data = userData([mkGroup(G_ALL, '全部', 0)], [], { boardConfig: { [G_ALL]: { viewMode: 'list', sortField: 'price', sortDirection: 'desc', priceHidden: true } } });
  assert.equal(desiredState['preferences:patch']({ groupId: G_ALL, patch: { viewMode: 'grid' } } as never, data), false);
});

test('preferences:patch not satisfied when config absent', () => {
  const data = userData([mkGroup(G_ALL, '全部', 0)], []);
  assert.equal(desiredState['preferences:patch']({ groupId: G_ALL, patch: { viewMode: 'grid' } } as never, data), false);
});

test('desiredState has exactly 10 mutation predicates', () => {
  const keys = Object.keys(desiredState);
  assert.equal(keys.length, 10);
});
