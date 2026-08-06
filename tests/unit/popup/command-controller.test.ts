// tests/unit/popup/command-controller.test.ts
// Task 13 Step 6 — CommandController 语义命令测试。
// 覆盖：createGroup 生成 ID、setPinned 从 Store 取 expectedRevision、重复 gesture 合并、
// stale search 拒绝、stale quote 拒绝、bootstrap 接线、常规成功 confirmed。
import assert from 'node:assert/strict';
import test from 'node:test';

import { CommandController } from '../../../src/popup/commands/command-controller.js';
import { FakeRpcClient } from '../../helpers/fake-rpc-client.js';
import { createStore } from '../../../src/popup/store/store.js';
import { reducer } from '../../../src/popup/store/reducer.js';
import { createInitialState } from '../../../src/popup/store/state.js';
import type { AppState } from '../../../src/popup/store/state.js';
import type { GroupId, StockCode, UserDataRevision, UserData, QuoteSnapshot, StockSearchResult } from '../../../src/domain/index.js';
import type { BootstrapResult, MutationResult } from '../../../src/protocol/index.js';

// ===== helpers =====

const G_ALL = 'g_all' as GroupId;
const G1 = 'g1' as GroupId;
const CODE_A = 'sh600519' as StockCode;
const CODE_B = 'sz000001' as StockCode;
const REV1 = 'sha256:rev1' as UserDataRevision;
const REV2 = 'sha256:rev2' as UserDataRevision;

function emptyUserData(): UserData {
  return { schemaVersion: 2, groups: [{ groupId: G_ALL, name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }], watchlist: [], boardConfig: {} };
}

function mutationResultNull(userData: UserData, revision: UserDataRevision): MutationResult<null> {
  return { value: null, userData, revision };
}

function bootstrapResult(userData: UserData, revision: UserDataRevision, quotes?: QuoteSnapshot): BootstrapResult {
  return {
    version: '2.0.0',
    userData,
    revision,
    quoteSnapshot: quotes ?? { results: {}, counts: { fresh: 0, cached: 0, missing: 0 }, attemptedAt: 0, succeededAt: null, generation: 0 }
  };
}

function seedRevision(store: ReturnType<typeof createStore>, revision: UserDataRevision, userData: UserData = emptyUserData()): void {
  store.dispatch({ type: 'bootstrap/confirmed', result: bootstrapResult(userData, revision) });
}

function setup(): { rpc: FakeRpcClient; store: ReturnType<typeof createStore>; controller: CommandController } {
  const rpc = new FakeRpcClient();
  const store = createStore(reducer, createInitialState());
  const controller = new CommandController(rpc, store);
  return { rpc, store, controller };
}

// ===== createGroup generates client-side ID =====

test('createGroup generates g_<uuid> as groupId', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  rpc.queueSuccess('group:create', { value: { groupId: G1, name: '新组', order: 1, isDefault: false, createdAt: 0, updatedAt: 0 }, userData: emptyUserData(), revision: REV2 });
  await controller.createGroup('新组');
  const payload = rpc.payloadsFor('group:create')[0] as { groupId: string; name: string; expectedRevision: UserDataRevision };
  assert.match(payload.groupId, /^g_[0-9a-f-]{36}$/, 'groupId = g_ + UUID');
  assert.equal(payload.name, '新组');
  assert.equal(payload.expectedRevision, REV1);
});

test('two createGroup calls produce distinct groupIds', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  rpc.queueSuccess('group:create', mutationResultNull(emptyUserData(), REV2));
  rpc.queueSuccess('group:create', mutationResultNull(emptyUserData(), REV2));
  await controller.createGroup('A');
  await controller.createGroup('B');
  const payloads = rpc.payloadsFor('group:create') as Array<{ groupId: string }>;
  assert.notEqual(payloads[0].groupId, payloads[1].groupId);
});

// ===== setPinned reads expectedRevision from Store =====

test('setPinned derives expectedRevision from current Store revision', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  rpc.queueSuccess('stock:setPinned', mutationResultNull(emptyUserData(), REV2));
  await controller.setPinned({ groupId: G_ALL, code: CODE_A, pinned: true, orderedCodes: [CODE_A] });
  const payload = rpc.payloadsFor('stock:setPinned')[0] as { expectedRevision: UserDataRevision };
  assert.equal(payload.expectedRevision, REV1);
  assert.equal(rpc.count('stock:setPinned'), 1);
});

// ===== duplicate gesture collapse =====

test('duplicate in-flight gesture collapses to a single RPC call', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  rpc.queueSuccess('stock:setPinned', mutationResultNull(emptyUserData(), REV2));
  const p1 = controller.setPinned({ groupId: G_ALL, code: CODE_A, pinned: true, orderedCodes: [CODE_A] });
  const p2 = controller.setPinned({ groupId: G_ALL, code: CODE_A, pinned: true, orderedCodes: [CODE_A] });
  await Promise.all([p1, p2]);
  assert.equal(rpc.count('stock:setPinned'), 1, '相同 gesture key 的 in-flight 命令合并');
});

test('distinct gestures do not collapse', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  rpc.queueSuccess('stock:setPinned', mutationResultNull(emptyUserData(), REV2));
  rpc.queueSuccess('stock:setPinned', mutationResultNull(emptyUserData(), REV2));
  await Promise.all([
    controller.setPinned({ groupId: G_ALL, code: CODE_A, pinned: true, orderedCodes: [CODE_A] }),
    controller.setPinned({ groupId: G_ALL, code: CODE_B, pinned: true, orderedCodes: [CODE_B] })
  ]);
  assert.equal(rpc.count('stock:setPinned'), 2);
});

// ===== stale search rejection =====

test('stale search response is rejected (later query wins)', async () => {
  const { rpc, store, controller } = setup();
  const resultsA: readonly StockSearchResult[] = [{ code: CODE_A, name: 'A', pinyin: 'a', tags: [] }];
  const resultsB: readonly StockSearchResult[] = [{ code: CODE_B, name: 'B', pinyin: 'b', tags: [] }];
  rpc.queueSuccess('stock:search', resultsA as never);
  rpc.queueSuccess('stock:search', resultsB as never);
  const p1 = controller.dialogSearchStocks('a'); // generation 1
  const p2 = controller.dialogSearchStocks('b'); // generation 2（取代）
  await Promise.all([p1, p2]);
  assert.equal(store.getState().async.searchGeneration, 2);
  assert.deepEqual(store.getState().view.dialogSearch.results, resultsB, '只接受最新 generation 的结果');
});

test('clearing the dialog query invalidates in-flight search responses', async () => {
  const { rpc, store, controller } = setup();
  const results: readonly StockSearchResult[] = [{ code: CODE_A, name: 'A', pinyin: 'a', tags: [] }];
  rpc.queueSuccess('stock:search', results as never);
  const p = controller.dialogSearchStocks('茅台'); // RPC 在途（微任务序列）
  await controller.dialogSearchStocks(''); // 清空输入
  await p; // 在途响应此刻落地
  // 空查询状态下不允许旧关键词的结果复活。
  assert.equal(store.getState().view.dialogSearch.keyword, '');
  assert.deepEqual(store.getState().view.dialogSearch.results, []);
  assert.equal(store.getState().async.stockSearch.status, 'idle');
});

test('fresh search response is confirmed', async () => {
  const { rpc, store, controller } = setup();
  const results: readonly StockSearchResult[] = [{ code: CODE_A, name: 'A', pinyin: 'a', tags: [] }];
  rpc.queueSuccess('stock:search', results as never);
  await controller.dialogSearchStocks('a');
  assert.deepEqual(store.getState().view.dialogSearch.results, results);
  assert.equal(store.getState().async.stockSearch.status, 'success');
});

// 对话框搜索绝不能污染工具栏的本地过滤词——两者是独立的两条路径。
test('dialog search never writes the toolbar filter keyword', async () => {
  const { rpc, store, controller } = setup();
  store.dispatch({ type: 'view/searchKeyword', keyword: 'toolbar-filter' });
  rpc.queueSuccess('stock:search', [{ code: CODE_A, name: 'A', pinyin: 'a', tags: [] }] as never);
  await controller.dialogSearchStocks('茅台');
  assert.equal(store.getState().view.searchKeyword, 'toolbar-filter');
  assert.equal(store.getState().view.dialogSearch.keyword, '茅台');
});

test('search failure with matching generation dispatches failed', async () => {
  const { rpc, store, controller } = setup();
  rpc.queueError('stock:search', { code: 'SEARCH_UNAVAILABLE', message: '搜索不可用', retryable: true });
  await controller.dialogSearchStocks('a');
  assert.equal(store.getState().async.stockSearch.status, 'error');
  assert.equal(store.getState().async.stockSearch.error?.code, 'SEARCH_UNAVAILABLE');
});

// ===== stale quote rejection =====

test('stale quote refresh response is rejected', async () => {
  const { rpc, store, controller } = setup();
  const snap1: QuoteSnapshot = { results: {}, counts: { fresh: 0, cached: 0, missing: 0 }, attemptedAt: 1, succeededAt: 1, generation: 1 };
  const snap2: QuoteSnapshot = { results: {}, counts: { fresh: 0, cached: 0, missing: 0 }, attemptedAt: 2, succeededAt: 2, generation: 2 };
  rpc.queueSuccess('quote:refresh', snap1 as never);
  rpc.queueSuccess('quote:refresh', snap2 as never);
  const p1 = controller.refreshQuotes([CODE_A]);
  const p2 = controller.refreshQuotes([CODE_A]);
  await Promise.all([p1, p2]);
  assert.equal(store.getState().domain.quotes.attemptedAt, 2, '只接受最新 generation 的快照');
});

test('fresh quote refresh response is confirmed', async () => {
  const { rpc, store, controller } = setup();
  const snap: QuoteSnapshot = { results: {}, counts: { fresh: 1, cached: 0, missing: 0 }, attemptedAt: 5, succeededAt: 5, generation: 1 };
  rpc.queueSuccess('quote:refresh', snap as never);
  await controller.refreshQuotes([CODE_A]);
  assert.equal(store.getState().domain.quotes.attemptedAt, 5);
  assert.equal(store.getState().async.quoteRefresh.status, 'success');
});

// ===== bootstrap wiring =====

test('bootstrap dispatches requested then confirmed and installs snapshot', async () => {
  const { rpc, store, controller } = setup();
  const ud = emptyUserData();
  rpc.queueBootstrap(bootstrapResult(ud, REV1));
  await controller.bootstrap();
  assert.equal(store.getState().async.bootstrap.status, 'success');
  assert.equal(store.getState().domain.revision, REV1);
});

test('bootstrap failure dispatches failed', async () => {
  const { rpc, store, controller } = setup();
  rpc.queueError('app:bootstrap', { code: 'STORAGE_UNAVAILABLE', message: '存储不可用', retryable: true });
  await controller.bootstrap();
  assert.equal(store.getState().async.bootstrap.status, 'error');
  assert.equal(store.getState().async.bootstrap.error?.code, 'STORAGE_UNAVAILABLE');
});

// ===== remaining semantic commands smoke (payload shape + single call) =====

test('removeStocks sends expectedRevision and codes/groupId', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  rpc.queueSuccess('stock:remove', mutationResultNull(emptyUserData(), REV2));
  await controller.removeStocks({ codes: [CODE_A], groupId: G_ALL });
  const payload = rpc.payloadsFor('stock:remove')[0] as { expectedRevision: UserDataRevision; codes: unknown; groupId: GroupId };
  assert.equal(payload.expectedRevision, REV1);
  assert.equal(payload.groupId, G_ALL);
});

test('moveStocks sends fromGroupId and targetGroupIds', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  rpc.queueSuccess('stock:move', mutationResultNull(emptyUserData(), REV2));
  await controller.moveStocks({ codes: [CODE_A], fromGroupId: G_ALL, targetGroupIds: [G1] });
  const payload = rpc.payloadsFor('stock:move')[0] as { fromGroupId: GroupId; targetGroupIds: readonly GroupId[] };
  assert.equal(payload.fromGroupId, G_ALL);
  assert.deepEqual([...payload.targetGroupIds], [G1]);
});

test('setOrder sends groupId and orderedCodes', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  rpc.queueSuccess('stock:setOrder', mutationResultNull(emptyUserData(), REV2));
  await controller.setOrder({ groupId: G_ALL, orderedCodes: [CODE_A, CODE_B] });
  const payload = rpc.payloadsFor('stock:setOrder')[0] as { groupId: GroupId; orderedCodes: readonly StockCode[] };
  assert.deepEqual([...payload.orderedCodes], [CODE_A, CODE_B]);
});

test('renameGroup sends groupId and name', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  rpc.queueSuccess('group:rename', mutationResultNull(emptyUserData(), REV2));
  await controller.renameGroup(G1, '新名');
  const payload = rpc.payloadsFor('group:rename')[0] as { groupId: GroupId; name: string };
  assert.equal(payload.groupId, G1);
  assert.equal(payload.name, '新名');
});

test('deleteGroup sends groupId', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  rpc.queueSuccess('group:delete', mutationResultNull(emptyUserData(), REV2));
  await controller.deleteGroup(G1);
  const payload = rpc.payloadsFor('group:delete')[0] as { groupId: GroupId };
  assert.equal(payload.groupId, G1);
});

test('setGroupOrder sends orderedGroupIds', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  rpc.queueSuccess('group:setOrder', mutationResultNull(emptyUserData(), REV2));
  await controller.setGroupOrder([G_ALL, G1]);
  const payload = rpc.payloadsFor('group:setOrder')[0] as { orderedGroupIds: readonly GroupId[] };
  assert.deepEqual([...payload.orderedGroupIds], [G_ALL, G1]);
});

test('patchPreferences sends groupId and patch', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  rpc.queueSuccess('preferences:patch', { value: { viewMode: 'grid', sortField: 'manual', sortDirection: 'asc', priceHidden: false }, userData: emptyUserData(), revision: REV2 });
  await controller.patchPreferences({ groupId: G_ALL, patch: { viewMode: 'grid' } });
  const payload = rpc.payloadsFor('preferences:patch')[0] as { groupId: GroupId; patch: { viewMode: string } };
  assert.equal(payload.groupId, G_ALL);
  assert.equal(payload.patch.viewMode, 'grid');
});

test('addStock sends code/name/groupIds', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  rpc.queueSuccess('stock:add', { value: { code: CODE_A, name: 'A', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 }, userData: emptyUserData(), revision: REV2 });
  await controller.addStock({ code: CODE_A, name: 'A', groupIds: [] });
  const payload = rpc.payloadsFor('stock:add')[0] as { code: StockCode; name: string; groupIds: readonly GroupId[] };
  assert.equal(payload.code, CODE_A);
  assert.equal(payload.name, 'A');
});

// ===== timeout reconciliation through controller (brief Step 1 verbatim behavior) =====

test('controller.setPinned reconciles after timeout when desired state committed', async () => {
  const { rpc, store, controller } = setup();
  seedRevision(store, REV1);
  const committed: UserData = {
    schemaVersion: 2,
    groups: [{ groupId: G_ALL, name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: [{ code: CODE_A, name: 'A', groupIds: [], manualOrder: { [G_ALL]: 0 }, pinned: { [G_ALL]: true }, addedAt: 0 }],
    boardConfig: {}
  };
  rpc.queueTimeout('stock:setPinned');
  rpc.queueBootstrap(bootstrapResult(committed, REV2));
  await controller.setPinned({ groupId: G_ALL, code: CODE_A, pinned: true, orderedCodes: [CODE_A] });
  assert.equal(rpc.count('stock:setPinned'), 1, 'desired 满足，不重试');
  assert.equal(store.getState().domain.revision, REV2);
  const key = 'stock:setPinned:g_all:sh600519';
  assert.equal((store.getState() as AppState).async.mutations[key], undefined, 'reconciled 后 key 移除');
});
