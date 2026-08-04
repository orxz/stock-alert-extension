// tests/unit/popup/reducer.test.ts
// Task 12 Step 1 — 纯 Reducer 测试：单一真相、不可变、全部 action 状态转换、stale generation 拒绝。
import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  GroupId,
  StockCode,
  UserDataRevision,
  QuoteSnapshot,
  Stock,
  StockSearchResult
} from '../../../src/domain/index.js';
import type { MutationResult } from '../../../src/protocol/index.js';
import { createInitialState } from '../../../src/popup/store/state.js';
import type { AppState, ClientError, DialogState } from '../../../src/popup/store/state.js';
import { reducer } from '../../../src/popup/store/reducer.js';
import { selectCurrentBoardConfig } from '../../../src/popup/store/selectors.js';

// ===== helpers =====

/** 递归冻结（模拟 deepFreeze），用于验证 reducer 不修改输入。 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

const G_ALL = 'g_all' as GroupId;
const G1 = 'g1' as GroupId;
const REV1 = 'sha256:rev1' as UserDataRevision;
const REV2 = 'sha256:rev2' as UserDataRevision;

const ERR: ClientError = { code: 'QUOTE_TIMEOUT', message: '行情超时', retryable: true };

function mkStock(code: string, name: string, extra?: Partial<Stock>): Stock {
  return Object.assign(
    { code: code as StockCode, name, groupIds: [], manualOrder: {}, pinned: {}, addedAt: 0 },
    extra || {}
  );
}

function emptySnapshot(generation = 0): QuoteSnapshot {
  return {
    results: {},
    counts: { fresh: 0, cached: 0, missing: 0 },
    attemptedAt: 0,
    succeededAt: null,
    generation
  };
}

function snapshotWith(code: string, price: number, generation = 0): QuoteSnapshot {
  return {
    results: {
      [code as StockCode]: {
        code: code as StockCode,
        status: 'fresh' as const,
        source: 'eastmoney' as const,
        provider: 'eastmoney' as const,
        fetchedAt: 0,
        error: null,
        quote: { code: code as StockCode, name: code, price, change: 1, changePercent: 0.5, amount: 100 }
      }
    },
    counts: { fresh: 1, cached: 0, missing: 0 },
    attemptedAt: 0,
    succeededAt: 0,
    generation
  };
}

/** 构造一个带 boardConfig[groupId] 的状态，currentGroupId = groupId。 */
function stateWithConfig(groupId: string, config: Partial<{ viewMode: 'list' | 'grid'; priceHidden: boolean; sortField: string; sortDirection: string }>): AppState {
  const base = createInitialState();
  const full = {
    viewMode: 'list' as const,
    sortField: 'manual' as const,
    sortDirection: 'asc' as const,
    priceHidden: false,
    ...config
  };
  return {
    ...base,
    domain: {
      ...base.domain,
      userData: {
        ...base.domain.userData,
        boardConfig: { [groupId as GroupId]: full }
      }
    },
    view: { ...base.view, currentGroupId: groupId as GroupId }
  };
}

/** 构造一个 MutationResult。 */
function mkMutationResult(revision: string = REV2): MutationResult<unknown> {
  return {
    value: null,
    userData: {
      schemaVersion: 2,
      groups: [{ groupId: G_ALL, name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
      watchlist: [],
      boardConfig: {}
    },
    revision: revision as UserDataRevision
  };
}

// ===== Step 1 逐字测试 =====

test('current preferences derive only from domain.boardConfig', () => {
  const state = stateWithConfig('g_all', { viewMode: 'list', priceHidden: true });
  assert.deepEqual(selectCurrentBoardConfig(state), state.domain.userData.boardConfig.g_all);
  assert.equal('viewMode' in state.view, false);
  assert.equal('priceHidden' in state.view, false);
});

test('reducer replaces authoritative mutation state without mutating input', () => {
  const result = mkMutationResult();
  const frozen = deepFreeze(createInitialState());
  const next = reducer(frozen, { type: 'mutation/confirmed', result });
  assert.notEqual(next, frozen);
  assert.equal(next.domain.revision, result.revision);
});

// ===== bootstrap =====

test('bootstrap/requested sets bootstrap async to loading', () => {
  const before = createInitialState();
  const next = reducer(before, { type: 'bootstrap/requested' });
  assert.equal(next.async.bootstrap.status, 'loading');
});

test('bootstrap/confirmed replaces domain userData/revision/quotes and sets success', () => {
  const before = createInitialState();
  const stock = mkStock('sh600519', '贵州茅台');
  const result = {
    version: '2.0.0' as const,
    userData: { schemaVersion: 2 as const, groups: [], watchlist: [stock], boardConfig: {} },
    revision: REV1,
    quoteSnapshot: snapshotWith('sh600519', 1500, 7)
  };
  const next = reducer(before, { type: 'bootstrap/confirmed', result });
  assert.equal(next.async.bootstrap.status, 'success');
  assert.equal(next.domain.userData.watchlist.length, 1);
  assert.equal(next.domain.revision, REV1);
  assert.equal(next.domain.quotes.generation, 7);
  assert.notEqual(next, before); // 新引用
});

test('bootstrap/failed sets bootstrap async to error with payload', () => {
  const before = createInitialState();
  const next = reducer(before, { type: 'bootstrap/failed', error: ERR });
  assert.equal(next.async.bootstrap.status, 'error');
  assert.equal(next.async.bootstrap.error?.code, 'QUOTE_TIMEOUT');
});

// ===== quote refresh + generation =====

test('quote/refresh/requested increments quoteGeneration and sets loading', () => {
  const before = createInitialState();
  const next = reducer(before, { type: 'quote/refresh/requested' });
  assert.equal(next.async.quoteRefresh.status, 'loading');
  assert.equal(next.async.quoteGeneration, 1);
});

test('quote/refresh/confirmed replaces quotes when generation matches', () => {
  const before = reducer(createInitialState(), { type: 'quote/refresh/requested' });
  const snap = snapshotWith('sh600519', 1500, 0);
  const next = reducer(before, { type: 'quote/refresh/confirmed', snapshot: snap, generation: 1 });
  assert.equal(next.async.quoteRefresh.status, 'success');
  assert.equal(next.domain.quotes.results['sh600519' as StockCode]?.quote?.price, 1500);
});

test('quote/refresh/confirmed is rejected when generation is stale (same reference)', () => {
  const before = reducer(createInitialState(), { type: 'quote/refresh/requested' });
  // 一个更新的 requested 使 generation 前进到 2
  const newer = reducer(before, { type: 'quote/refresh/requested' });
  const snap = snapshotWith('sh600519', 1500, 0);
  const next = reducer(newer, { type: 'quote/refresh/confirmed', snapshot: snap, generation: 1 });
  assert.equal(next, newer); // stale，返回相同引用
});

test('quote/refresh/failed sets error when generation matches', () => {
  const before = reducer(createInitialState(), { type: 'quote/refresh/requested' });
  const next = reducer(before, { type: 'quote/refresh/failed', error: ERR, generation: 1 });
  assert.equal(next.async.quoteRefresh.status, 'error');
});

test('quote/refresh/failed is rejected when generation is stale', () => {
  const before = reducer(createInitialState(), { type: 'quote/refresh/requested' });
  const newer = reducer(before, { type: 'quote/refresh/requested' });
  const next = reducer(newer, { type: 'quote/refresh/failed', error: ERR, generation: 1 });
  assert.equal(next, newer);
});

// ===== search + generation =====

test('search/keyword updates view.searchKeyword', () => {
  const before = createInitialState();
  const next = reducer(before, { type: 'search/keyword', keyword: '茅台' });
  assert.equal(next.view.searchKeyword, '茅台');
});

test('search/requested increments searchGeneration, sets query and loading', () => {
  const before = createInitialState();
  const next = reducer(before, { type: 'search/requested', query: '茅台', generation: 1 });
  assert.equal(next.async.stockSearch.status, 'loading');
  assert.equal(next.async.searchGeneration, 1);
});

test('search/confirmed replaces view.searchResults when generation matches', () => {
  let state = reducer(createInitialState(), { type: 'search/requested', query: '茅', generation: 1 });
  const results: StockSearchResult[] = [
    { code: 'sh600519' as StockCode, name: '贵州茅台', pinyin: 'gzmt', tags: [] }
  ];
  state = reducer(state, { type: 'search/confirmed', results, generation: 1 });
  assert.equal(state.async.stockSearch.status, 'success');
  assert.equal(state.view.searchResults.length, 1);
});

test('search/confirmed is rejected when generation is stale', () => {
  let state = reducer(createInitialState(), { type: 'search/requested', query: '茅', generation: 1 });
  state = reducer(state, { type: 'search/requested', query: '茅台', generation: 2 });
  const results: StockSearchResult[] = [];
  const next = reducer(state, { type: 'search/confirmed', results, generation: 1 });
  assert.equal(next, state); // stale
});

test('search/failed sets error when generation matches', () => {
  let state = reducer(createInitialState(), { type: 'search/requested', query: '茅', generation: 1 });
  state = reducer(state, { type: 'search/failed', error: ERR, generation: 1 });
  assert.equal(state.async.stockSearch.status, 'error');
});

test('search/failed is rejected when generation is stale', () => {
  let state = reducer(createInitialState(), { type: 'search/requested', query: '茅', generation: 1 });
  state = reducer(state, { type: 'search/requested', query: '茅台', generation: 2 });
  const next = reducer(state, { type: 'search/failed', error: ERR, generation: 1 });
  assert.equal(next, state);
});

// ===== mutations =====

test('mutation/pending sets mutations[key] to pending', () => {
  const next = reducer(createInitialState(), { type: 'mutation/pending', key: 'op-1' });
  assert.equal(next.async.mutations['op-1']?.status, 'pending');
});

test('mutation/uncertain sets mutations[key] to uncertain', () => {
  let state = reducer(createInitialState(), { type: 'mutation/pending', key: 'op-1' });
  state = reducer(state, { type: 'mutation/uncertain', key: 'op-1' });
  assert.equal(state.async.mutations['op-1']?.status, 'uncertain');
});

test('mutation/confirmed replaces domain userData/revision and removes the mutation key', () => {
  let state = reducer(createInitialState(), { type: 'mutation/pending', key: 'op-1' });
  const result = mkMutationResult(REV2);
  state = reducer(state, { type: 'mutation/confirmed', key: 'op-1', result });
  assert.equal(state.domain.revision, REV2);
  assert.equal(state.async.mutations['op-1'], undefined);
});

test('mutation/reconciled removes the mutation key', () => {
  let state = reducer(createInitialState(), { type: 'mutation/uncertain', key: 'op-1' });
  state = reducer(state, { type: 'mutation/reconciled', key: 'op-1' });
  assert.equal(state.async.mutations['op-1'], undefined);
});

test('mutation/failed sets mutations[key] to failed with error', () => {
  let state = reducer(createInitialState(), { type: 'mutation/pending', key: 'op-1' });
  state = reducer(state, { type: 'mutation/failed', key: 'op-1', error: ERR });
  assert.equal(state.async.mutations['op-1']?.status, 'failed');
  assert.equal(state.async.mutations['op-1']?.error?.code, 'QUOTE_TIMEOUT');
});

// ===== view =====

test('view/currentGroup updates currentGroupId', () => {
  const next = reducer(createInitialState(), { type: 'view/currentGroup', groupId: G1 });
  assert.equal(next.view.currentGroupId, G1);
});

test('view/searchKeyword updates searchKeyword', () => {
  const next = reducer(createInitialState(), { type: 'view/searchKeyword', keyword: 'abc' });
  assert.equal(next.view.searchKeyword, 'abc');
});

test('view/selection updates selectedCodes', () => {
  const codes = ['sh600519' as StockCode, 'sz000001' as StockCode];
  const next = reducer(createInitialState(), { type: 'view/selection', codes });
  assert.deepEqual([...next.view.selectedCodes], codes);
});

test('view/clearSelection empties selectedCodes', () => {
  const before = reducer(createInitialState(), { type: 'view/selection', codes: ['sh600519' as StockCode] });
  const next = reducer(before, { type: 'view/clearSelection' });
  assert.equal(next.view.selectedCodes.length, 0);
});

test('view/selectionMode enables and clears selection', () => {
  // 先选中一些
  let state = reducer(createInitialState(), { type: 'view/selection', codes: ['sh600519' as StockCode] });
  // 启用选择模式 → 保留已有选择
  state = reducer(state, { type: 'view/selectionMode', enabled: true });
  assert.equal(state.view.selectionMode, true);
  assert.equal(state.view.selectedCodes.length, 1);
  // 关闭选择模式 → 清空选择
  state = reducer(state, { type: 'view/selectionMode', enabled: false });
  assert.equal(state.view.selectionMode, false);
  assert.equal(state.view.selectedCodes.length, 0);
});

// ===== mutation 无 key → DEFAULT_MUTATION_KEY =====

test('mutation/pending without key uses default key', () => {
  const next = reducer(createInitialState(), { type: 'mutation/pending' });
  assert.equal(next.async.mutations['__default__']?.status, 'pending');
});

test('mutation/uncertain without key uses default key', () => {
  let state = reducer(createInitialState(), { type: 'mutation/pending' });
  state = reducer(state, { type: 'mutation/uncertain' });
  assert.equal(state.async.mutations['__default__']?.status, 'uncertain');
});

test('mutation/confirmed without key uses default key', () => {
  let state = reducer(createInitialState(), { type: 'mutation/pending' });
  const result = mkMutationResult(REV2);
  state = reducer(state, { type: 'mutation/confirmed', result });
  assert.equal(state.async.mutations['__default__'], undefined);
});

test('mutation/reconciled without key uses default key', () => {
  let state = reducer(createInitialState(), { type: 'mutation/pending' });
  state = reducer(state, { type: 'mutation/reconciled' });
  assert.equal(state.async.mutations['__default__'], undefined);
});

test('mutation/failed without key uses default key', () => {
  const next = reducer(createInitialState(), { type: 'mutation/failed', error: ERR });
  assert.equal(next.async.mutations['__default__']?.status, 'failed');
});

// ===== overlay =====

test('overlay/dialog sets and clears dialog', () => {
  const dialog: DialogState = { kind: 'rename-group', groupId: G1, currentName: '旧名' };
  let state = reducer(createInitialState(), { type: 'overlay/dialog', dialog });
  assert.equal(state.overlay.dialog?.kind, 'rename-group');
  state = reducer(state, { type: 'overlay/dialog', dialog: null });
  assert.equal(state.overlay.dialog, null);
});

test('overlay/menu sets and clears menu', () => {
  let state = reducer(createInitialState(), { type: 'overlay/menu', menu: { anchor: 'btn-1' } });
  assert.equal(state.overlay.menu?.anchor, 'btn-1');
  state = reducer(state, { type: 'overlay/menu', menu: null });
  assert.equal(state.overlay.menu, null);
});

test('overlay/toast sets and clears toast', () => {
  let state = reducer(createInitialState(), { type: 'overlay/toast', toast: { message: '已保存', kind: 'success' } });
  assert.equal(state.overlay.toast?.message, '已保存');
  state = reducer(state, { type: 'overlay/toast', toast: null });
  assert.equal(state.overlay.toast, null);
});

test('overlay/focusReturn sets and clears id', () => {
  let state = reducer(createInitialState(), { type: 'overlay/focusReturn', id: 'search-input' });
  assert.equal(state.overlay.focusReturnId, 'search-input');
  state = reducer(state, { type: 'overlay/focusReturn', id: null });
  assert.equal(state.overlay.focusReturnId, null);
});

// ===== 不可变性与引用相等 =====

test('unknown action returns the same reference (no clone)', () => {
  const before = createInitialState();
  const next = reducer(before, { type: 'unknown/whatever' } as unknown as Parameters<typeof reducer>[1]);
  assert.equal(next, before);
});

test('reducer clones only the changed branch (structural sharing)', () => {
  const before = createInitialState();
  const next = reducer(before, { type: 'view/searchKeyword', keyword: 'x' });
  assert.notEqual(next, before);
  assert.notEqual(next.view, before.view);
  // 未变更分支保持引用相等
  assert.equal(next.domain, before.domain);
  assert.equal(next.async, before.async);
  assert.equal(next.overlay, before.overlay);
});

test('reducer does not throw on deeply frozen input across all branches', () => {
  const frozen = deepFreeze(createInitialState());
  // 触发多个分支变更
  assert.doesNotThrow(() => reducer(frozen, { type: 'overlay/toast', toast: { message: 'hi', kind: 'info' } }));
  assert.doesNotThrow(() => reducer(frozen, { type: 'mutation/pending', key: 'k' }));
});

// ===== theme（view 区纯展示偏好）=====

test('view/theme updates theme and preserves other branches', () => {
  const state = createInitialState();
  const next = reducer(state, { type: 'view/theme', theme: 'light' });
  assert.equal(next.view.theme, 'light');
  assert.equal(next.domain, state.domain); // 未变更分支引用相等
  assert.equal(next.async, state.async);
  assert.equal(next.overlay, state.overlay);
});

test('view/theme to dark works', () => {
  const state = createInitialState();
  const light = reducer(state, { type: 'view/theme', theme: 'light' });
  const dark = reducer(light, { type: 'view/theme', theme: 'dark' });
  assert.equal(dark.view.theme, 'dark');
});
