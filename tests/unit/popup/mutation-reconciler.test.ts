// tests/unit/popup/mutation-reconciler.test.ts
// Task 13 Step 5 — MutationReconciler 对账路径测试。
// 覆盖：成功 confirmed、非 uncertain failed、timeout→bootstrap→desired 满足→reconciled（不重试）、
// timeout→bootstrap→desired 不满足→retry once→confirmed、第二次 uncertain 不重试、CONFLICT resync→failed。
import assert from 'node:assert/strict';
import test from 'node:test';

import { MutationReconciler, toSafeClientError } from '../../../src/popup/commands/mutation-reconciler.js';
import { RpcUncertainError } from '../../../src/popup/rpc-client.js';
import { FakeRpcClient } from '../../helpers/fake-rpc-client.js';
import { createStore } from '../../../src/popup/store/store.js';
import { reducer } from '../../../src/popup/store/reducer.js';
import { createInitialState } from '../../../src/popup/store/state.js';
import type { AppState, ClientError } from '../../../src/popup/store/state.js';
import type { GroupId, StockCode, UserDataRevision, UserData, Stock } from '../../../src/domain/index.js';
import type { BootstrapResult, MutationResult } from '../../../src/protocol/index.js';

// ===== helpers =====

const G_ALL = 'g_all' as GroupId;
const G1 = 'g1' as GroupId;
const CODE_A = 'sh600519' as StockCode;
const REV_OLD = 'sha256:old' as UserDataRevision;
const REV_NEW = 'sha256:new' as UserDataRevision;

function emptyUserData(): UserData {
  return { schemaVersion: 2, groups: [{ groupId: G_ALL, name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }], watchlist: [], boardConfig: {} };
}

function bootstrapFrom(userData: UserData, revision: UserDataRevision): BootstrapResult {
  return {
    version: '2.0.0',
    userData,
    revision,
    quoteSnapshot: { results: {}, counts: { fresh: 0, cached: 0, missing: 0 }, attemptedAt: 0, succeededAt: null, generation: 0 }
  };
}

function mutationResultFrom(userData: UserData, revision: UserDataRevision): MutationResult<null> {
  return { value: null, userData, revision };
}

function mutationStatus(state: AppState, key: string): { status: string; error?: ClientError } | undefined {
  return state.async.mutations[key];
}

function setup(): { store: ReturnType<typeof createStore> } {
  return { store: createStore(reducer, createInitialState()) };
}

// ===== happy path =====

test('successful mutation dispatches pending then confirmed and clears the key', async () => {
  const { store } = setup();
  const rpc = new FakeRpcClient();
  const reconciler = new MutationReconciler(rpc, store);

  rpc.queueSuccess('group:rename', mutationResultFrom(emptyUserData(), REV_NEW));
  await reconciler.execute('group:rename', { expectedRevision: REV_OLD, groupId: G1, name: 'X' } as never, 'k1');

  assert.equal(rpc.count('group:rename'), 1);
  assert.equal(rpc.count('app:bootstrap'), 0);
  assert.equal(mutationStatus(store.getState(), 'k1'), undefined, 'confirmed 后 key 从表中移除');
});

// ===== non-uncertain failure =====

test('non-uncertain error dispatches failed and does not bootstrap or retry', async () => {
  const { store } = setup();
  const rpc = new FakeRpcClient();
  const reconciler = new MutationReconciler(rpc, store);

  rpc.queueError('stock:add', { code: 'VALIDATION_FAILED', message: '无效', retryable: false });
  await reconciler.execute('stock:add', { expectedRevision: REV_OLD, code: CODE_A, name: 'A', groupIds: [] } as never, 'k2');

  assert.equal(rpc.count('stock:add'), 1);
  assert.equal(rpc.count('app:bootstrap'), 0);
  const m = mutationStatus(store.getState(), 'k2');
  assert.equal(m?.status, 'failed');
  assert.equal(m?.error?.code, 'VALIDATION_FAILED');
});

// ===== brief Step 1 test 1: timeout already committed → reconciled (no retry) =====

test('timeout resync confirms a mutation that committed remotely', async () => {
  const { store } = setup();
  const rpc = new FakeRpcClient();
  const reconciler = new MutationReconciler(rpc, store);

  const committed = { ...emptyUserData(), groups: [
    { groupId: G_ALL, name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 },
    { groupId: G1, name: '新名称', order: 1, isDefault: false, createdAt: 0, updatedAt: 0 }
  ] } as UserData;
  rpc.queueTimeout('group:rename');
  rpc.queueBootstrap(bootstrapFrom(committed, REV_NEW));
  await reconciler.execute('group:rename', { expectedRevision: REV_OLD, groupId: G1, name: '新名称' } as never, 'pin');

  // bootstrap 数据已安装；desiredState 满足 → reconciled（不重试）
  assert.equal(rpc.count('group:rename'), 1, 'desiredState 满足，不重试');
  assert.equal(rpc.count('app:bootstrap'), 1);
  assert.equal(mutationStatus(store.getState(), 'pin'), undefined, 'reconciled 移除 key');
  assert.equal(store.getState().domain.revision, REV_NEW);
});

// ===== brief Step 1 test 2: timeout, desired absent → retry once with resynced revision =====

test('timeout resync retries only when desired state is absent', async () => {
  const { store } = setup();
  const rpc = new FakeRpcClient();
  const reconciler = new MutationReconciler(rpc, store);

  rpc.queueTimeout('group:rename');
  rpc.queueBootstrap(bootstrapFrom(emptyUserData(), REV_NEW)); // 仍是旧名 → desired 不满足
  rpc.queueSuccess('group:rename', mutationResultFrom({ ...emptyUserData(), groups: [
    { groupId: G_ALL, name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 },
    { groupId: G1, name: '新名称', order: 1, isDefault: false, createdAt: 0, updatedAt: 0 }
  ] } as UserData, REV_NEW));
  await reconciler.execute('group:rename', { expectedRevision: REV_OLD, groupId: G1, name: '新名称' } as never, 'k3');

  assert.equal(rpc.count('group:rename'), 2, '首次 + 一次重试');
  assert.equal(rpc.count('app:bootstrap'), 1);
  const retriedPayload = rpc.payloadsFor('group:rename')[1] as { expectedRevision: UserDataRevision };
  assert.equal(retriedPayload.expectedRevision, REV_NEW, '重试携带 resync 后的 revision');
  assert.equal(mutationStatus(store.getState(), 'k3'), undefined, '重试成功后移除 key');
});

// ===== second uncertain: no second retry, stays visible =====

test('second consecutive uncertain does not retry again; stays uncertain', async () => {
  const { store } = setup();
  const rpc = new FakeRpcClient();
  const reconciler = new MutationReconciler(rpc, store);

  rpc.queueTimeout('group:rename');
  rpc.queueBootstrap(bootstrapFrom(emptyUserData(), REV_NEW)); // desired 不满足
  rpc.queueTimeout('group:rename'); // 重试也超时
  await reconciler.execute('group:rename', { expectedRevision: REV_OLD, groupId: G1, name: '新名称' } as never, 'k4');

  assert.equal(rpc.count('group:rename'), 2, '首次 + 一次重试，不再第三次');
  assert.equal(rpc.count('app:bootstrap'), 1, '只 bootstrap 一次');
  const m = mutationStatus(store.getState(), 'k4');
  assert.equal(m?.status, 'uncertain', '保持 uncertain 可见，需用户手动重试');
});

// ===== CONFLICT on retry → failed, but bootstrap data already installed =====

test('CONFLICT on retry marks failed while bootstrap data remains installed', async () => {
  const { store } = setup();
  const rpc = new FakeRpcClient();
  const reconciler = new MutationReconciler(rpc, store);

  rpc.queueTimeout('group:rename');
  rpc.queueBootstrap(bootstrapFrom(emptyUserData(), REV_NEW)); // desired 不满足
  rpc.queueError('group:rename', { code: 'CONFLICT', message: '冲突', retryable: true });
  await reconciler.execute('group:rename', { expectedRevision: REV_OLD, groupId: G1, name: '新名称' } as never, 'k5');

  assert.equal(rpc.count('group:rename'), 2);
  const m = mutationStatus(store.getState(), 'k5');
  assert.equal(m?.status, 'failed');
  assert.equal(m?.error?.code, 'CONFLICT');
  // bootstrap 已在前一步安装新数据（不覆盖）
  assert.equal(store.getState().domain.revision, REV_NEW);
});

// ===== non-uncertain error on retry also marks failed =====

test('non-uncertain error on retry marks failed', async () => {
  const { store } = setup();
  const rpc = new FakeRpcClient();
  const reconciler = new MutationReconciler(rpc, store);

  rpc.queueTimeout('group:rename');
  rpc.queueBootstrap(bootstrapFrom(emptyUserData(), REV_NEW));
  rpc.queueError('group:rename', { code: 'NOT_FOUND', message: '分组不存在', retryable: false });
  await reconciler.execute('group:rename', { expectedRevision: REV_OLD, groupId: G1, name: '新名称' } as never, 'k6');

  const m = mutationStatus(store.getState(), 'k6');
  assert.equal(m?.status, 'failed');
  assert.equal(m?.error?.code, 'NOT_FOUND');
});

// ===== toSafeClientError =====

test('toSafeClientError extracts code/message/retryable from AppError-shape errors', () => {
  const err = new Error('无效') as Error & ClientError;
  err.code = 'VALIDATION_FAILED';
  err.retryable = false;
  const safe = toSafeClientError(err);
  assert.deepEqual(safe, { code: 'VALIDATION_FAILED', message: '无效', retryable: false });
});

test('toSafeClientError returns UNKNOWN for non-AppError errors', () => {
  const safe = toSafeClientError('some string');
  assert.deepEqual(safe, { code: 'UNKNOWN', message: '未知错误', retryable: false });
});

test('toSafeClientError handles RpcUncertainError gracefully as UNKNOWN', () => {
  const safe = toSafeClientError(new RpcUncertainError());
  // RpcUncertainError 有 code='RPC_UNCERTAIN' 但无 retryable → 回退为 UNKNOWN（retryable 缺失）
  assert.deepEqual(safe, { code: 'UNKNOWN', message: '未知错误', retryable: false });
});
