// tests/unit/popup-actions.test.mjs — popup-actions.js 纯函数单测
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
global.StockUtils = require('../../stock-utils.js');
global.document = undefined;
const State = require('../../popup-state.js');
const Render = require('../../popup-render.js');
const Actions = require('../../popup-actions.js');

// 默认 Bridge mock
function mockBridge(handler = () => ({})) {
  global.Bridge = { async send(action, payload) { return handler(action, payload); } };
  Actions.bind(State, Render);
}

test('withMutationLock deduplicates concurrent calls with same key', async () => {
  mockBridge();
  let callCount = 0;
  const action = async () => {
    callCount += 1;
    await new Promise((r) => setTimeout(r, 20));
    return callCount;
  };
  const [a, b] = await Promise.all([
    Actions.withMutationLock('test-key', action),
    Actions.withMutationLock('test-key', action)
  ]);
  // 第二次调用复用同一个 promise，action 只执行一次
  assert.equal(callCount, 1);
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test('withMutationLock allows different keys to run independently', async () => {
  mockBridge();
  const results = [];
  const action = async (label) => {
    await new Promise((r) => setTimeout(r, 10));
    results.push(label);
    return label;
  };
  await Promise.all([
    Actions.withMutationLock('key-a', () => action('a')),
    Actions.withMutationLock('key-b', () => action('b'))
  ]);
  assert.equal(results.length, 2);
  assert.ok(results.includes('a'));
  assert.ok(results.includes('b'));
});

test('withMutationLock clears the slot after settling so later runs can proceed', async () => {
  mockBridge();
  let count = 0;
  const action = async () => { count += 1; return count; };
  await Actions.withMutationLock('slot-test', action);
  await Actions.withMutationLock('slot-test', action);
  assert.equal(count, 2);
});

test('persistBoardPatch merges patch into boardConfig on success', async () => {
  mockBridge(async (action, payload) => {
    assert.equal(action, 'storage:saveBoardConfig');
    assert.equal(payload.groupId, 'g_all');
    assert.deepEqual(payload.patch, { sortField: 'price' });
    return {};
  });
  State.current.boardConfig = {};
  const ok = await Actions.persistBoardPatch('g_all', { sortField: 'price' });
  assert.equal(ok, true);
  assert.equal(State.current.boardConfig['g_all'].sortField, 'price');
});

test('persistBoardPatch returns false and toasts on Bridge error', async () => {
  let toastMsg = null;
  Render.toast = (msg) => { toastMsg = msg; };
  global.Bridge = {
    async send() { throw new Error('storage full'); }
  };
  Actions.bind(State, Render);
  const ok = await Actions.persistBoardPatch('g_all', { sortField: 'price' });
  assert.equal(ok, false);
  assert.ok(toastMsg);
  assert.match(toastMsg, /失败|重试/);
});

test('persistBoardPatch preserves existing boardConfig keys on partial patch', async () => {
  mockBridge(() => ({}));
  State.current.boardConfig = {
    g_all: { viewMode: 'list', sortField: 'manual' }
  };
  await Actions.persistBoardPatch('g_all', { sortField: 'price' });
  assert.equal(State.current.boardConfig['g_all'].viewMode, 'list');
  assert.equal(State.current.boardConfig['g_all'].sortField, 'price');
});
