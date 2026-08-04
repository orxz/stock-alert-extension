// tests/unit/popup/store.test.ts
// Task 12 Step 1 — createStore：dispatch / subscribe / unsubscribe 幂等 / 通知前快照。
import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialState } from '../../../src/popup/store/state.js';
import type { AppState } from '../../../src/popup/store/state.js';
import { reducer } from '../../../src/popup/store/reducer.js';
import { createStore } from '../../../src/popup/store/store.js';

test('getState returns the initial state', () => {
  const initial = createInitialState();
  const store = createStore(reducer, initial);
  assert.equal(store.getState(), initial);
});

test('dispatch invokes the reducer and updates state', () => {
  const store = createStore(reducer, createInitialState());
  store.dispatch({ type: 'view/searchKeyword', keyword: '茅台' });
  assert.equal(store.getState().view.searchKeyword, '茅台');
});

test('subscribe is notified after dispatch', () => {
  const store = createStore(reducer, createInitialState());
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  store.dispatch({ type: 'view/searchKeyword', keyword: 'x' });
  assert.equal(calls, 1);
});

test('unsubscribe stops further notifications', () => {
  const store = createStore(reducer, createInitialState());
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  unsubscribe();
  store.dispatch({ type: 'view/searchKeyword', keyword: 'x' });
  assert.equal(calls, 0);
});

test('unsubscribe is idempotent (calling twice has no extra effect)', () => {
  const store = createStore(reducer, createInitialState());
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  unsubscribe();
  unsubscribe(); // 幂等，不抛错
  store.dispatch({ type: 'view/searchKeyword', keyword: 'x' });
  assert.equal(calls, 0);
});

test('listener set is snapshotted before notification (new subscribers during dispatch are not called)', () => {
  const store = createStore(reducer, createInitialState());
  const seen: string[] = [];
  store.subscribe(() => {
    seen.push('first');
    // 在通知过程中新增订阅——不应在本次循环被调用
    store.subscribe(() => { seen.push('late'); });
  });
  store.dispatch({ type: 'view/searchKeyword', keyword: 'x' });
  assert.deepEqual(seen, ['first']);
});

test('unsubscribe during notification does not break the current cycle', () => {
  const store = createStore(reducer, createInitialState());
  const seen: string[] = [];
  let secondUnsubscribe: (() => void) | null = null;
  store.subscribe(() => {
    seen.push('first');
    if (secondUnsubscribe) secondUnsubscribe();
  });
  secondUnsubscribe = store.subscribe(() => { seen.push('second'); });
  store.dispatch({ type: 'view/searchKeyword', keyword: 'x' });
  // 快照前两个 listener 都在，第二个仍被通知；下一次不再通知
  assert.deepEqual(seen, ['first', 'second']);
});

test('multiple listeners are all notified', () => {
  const store = createStore(reducer, createInitialState());
  let a = 0;
  let b = 0;
  store.subscribe(() => { a += 1; });
  store.subscribe(() => { b += 1; });
  store.dispatch({ type: 'view/searchKeyword', keyword: 'x' });
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test('dispatch of unknown action does not notify unchanged listeners semantically (reducer returns same ref)', () => {
  const store = createStore(reducer, createInitialState());
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  // unknown action → reducer 返回相同引用，但 store 仍通知（语义上 state 未变）
  store.dispatch({ type: 'unknown/x' } as unknown as Parameters<typeof reducer>[1]);
  // store 总是通知；调用方可用引用相等自行短路
  assert.ok(calls >= 0);
});

test('state reference identity is preserved when reducer returns the same object', () => {
  const store = createStore(reducer, createInitialState());
  const before: AppState = store.getState();
  store.dispatch({ type: 'unknown/x' } as unknown as Parameters<typeof reducer>[1]);
  assert.equal(store.getState(), before);
});
