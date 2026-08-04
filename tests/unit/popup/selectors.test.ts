// tests/unit/popup/selectors.test.ts
// Task 12 Step 1 — Selectors / ViewModels：selectCurrentBoardConfig、selectVisibleStocks（排序/过滤/掩码）、空状态、各组件 ViewModel。
import assert from 'node:assert/strict';
import test from 'node:test';

import type { GroupId, StockCode, QuoteSnapshot, Stock, BoardConfig, UserData } from '../../../src/domain/index.js';
import { createInitialState } from '../../../src/popup/store/state.js';
import type { AppState } from '../../../src/popup/store/state.js';
import {
  selectCurrentBoardConfig,
  selectVisibleStocks,
  selectGroupTabs,
  selectToolbar,
  selectHeader,
  selectBatchToolbar,
  selectQuoteStatus,
  selectLiveRegion
} from '../../../src/popup/store/selectors.js';

// ===== helpers =====

const G_ALL = 'g_all' as GroupId;
const G1 = 'g1' as GroupId;

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

function snapshotFor(stocks: Stock[], generation = 0): QuoteSnapshot {
  const results: Record<string, unknown> = {};
  let fresh = 0;
  let missing = 0;
  for (const s of stocks) {
    results[s.code as string] = {
      code: s.code,
      status: 'fresh',
      source: 'eastmoney',
      provider: 'eastmoney',
      fetchedAt: 0,
      error: null,
      quote: {
        code: s.code,
        name: s.name,
        price: 100,
        change: 1,
        changePercent: 0.5,
        amount: 1000
      }
    };
    fresh += 1;
  }
  return { results, counts: { fresh, cached: 0, missing }, attemptedAt: 0, succeededAt: 0, generation };
}

function config(partial?: Partial<BoardConfig>): BoardConfig {
  return {
    viewMode: 'list',
    sortField: 'manual',
    sortDirection: 'asc',
    priceHidden: false,
    ...partial
  };
}

function stateWith(stocks: Stock[], opts?: { quotes?: QuoteSnapshot; boardConfig?: Record<string, BoardConfig>; currentGroupId?: string; keyword?: string; selectedCodes?: string[]; succeededAt?: number | null }): AppState {
  const base = createInitialState();
  const userData: UserData = {
    schemaVersion: 2,
    groups: [{ groupId: G_ALL, name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }],
    watchlist: stocks,
    boardConfig: opts?.boardConfig ?? {}
  };
  return {
    ...base,
    domain: {
      ...base.domain,
      userData,
      quotes: opts?.quotes ?? emptySnapshot()
    },
    view: {
      ...base.view,
      currentGroupId: (opts?.currentGroupId ?? 'g_all') as GroupId,
      searchKeyword: opts?.keyword ?? '',
      selectedCodes: (opts?.selectedCodes ?? []).map((c) => c as StockCode)
    }
  };
}

// ===== selectCurrentBoardConfig =====

test('selectCurrentBoardConfig returns the boardConfig for the current group', () => {
  const cfg = config({ viewMode: 'grid', priceHidden: true });
  const state = stateWith([], { boardConfig: { g_all: cfg } });
  assert.deepEqual(selectCurrentBoardConfig(state), cfg);
});

test('selectCurrentBoardConfig falls back to default when group has no config', () => {
  const state = stateWith([], { boardConfig: {} });
  const cfg = selectCurrentBoardConfig(state);
  assert.equal(cfg.viewMode, 'list');
  assert.equal(cfg.priceHidden, false);
  assert.equal(cfg.sortField, 'manual');
});

test('selectCurrentBoardConfig reflects only domain (view has no preference fields)', () => {
  const state = stateWith([], { boardConfig: { g_all: config({ priceHidden: true }) } });
  selectCurrentBoardConfig(state);
  assert.equal('viewMode' in state.view, false);
  assert.equal('priceHidden' in state.view, false);
});

// ===== selectVisibleStocks =====

test('selectVisibleStocks returns empty array for empty state', () => {
  assert.equal(selectVisibleStocks(createInitialState()).length, 0);
});

test('selectVisibleStocks returns ViewModels in sorted order', () => {
  const stocks = [
    mkStock('sh600519', '茅台', { pinned: { g_all: false } }),
    mkStock('sz000001', '平安', { pinned: { g_all: true } })
  ];
  const state = stateWith(stocks, {
    quotes: snapshotFor(stocks),
    boardConfig: { g_all: config({ sortField: 'name', sortDirection: 'asc' }) }
  });
  const vms = selectVisibleStocks(state);
  // 平安 pinned 在前
  assert.deepEqual(vms.map((v) => v.code), ['sz000001', 'sh600519']);
  assert.equal(vms[0].pinned, true);
  assert.equal(vms[1].pinned, false);
});

test('selectVisibleStocks maps price/change/changePercent and status into ViewModel', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const state = stateWith(stocks, { quotes: snapshotFor(stocks) });
  const [vm] = selectVisibleStocks(state);
  assert.equal(vm.code, 'sh600519');
  assert.equal(vm.name, '茅台');
  assert.equal(vm.price, 100);
  assert.equal(vm.status, 'fresh');
});

test('selectVisibleStocks masks displayPrice when priceHidden is true', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const state = stateWith(stocks, {
    quotes: snapshotFor(stocks),
    boardConfig: { g_all: config({ priceHidden: true }) }
  });
  const [vm] = selectVisibleStocks(state);
  assert.notEqual(vm.displayPrice, '100');
  assert.ok(vm.displayPrice.includes('*'));
});

test('selectVisibleStocks shows numeric price when priceHidden is false', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const state = stateWith(stocks, {
    quotes: snapshotFor(stocks),
    boardConfig: { g_all: config({ priceHidden: false }) }
  });
  const [vm] = selectVisibleStocks(state);
  assert.equal(vm.displayPrice, '100.00');
});

test('selectVisibleStocks filters by search keyword (code or name)', () => {
  const stocks = [
    mkStock('sh600519', '贵州茅台'),
    mkStock('sz000001', '平安银行')
  ];
  const state = stateWith(stocks, {
    quotes: snapshotFor(stocks),
    keyword: '茅台'
  });
  const vms = selectVisibleStocks(state);
  assert.equal(vms.length, 1);
  assert.equal(vms[0].code, 'sh600519');
});

test('selectVisibleStocks marks staleLabel for cached quotes', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const quotes: QuoteSnapshot = {
    results: {
      ['sh600519' as StockCode]: {
        code: 'sh600519' as StockCode,
        status: 'cached',
        source: 'cache',
        provider: 'eastmoney',
        fetchedAt: 0,
        error: null,
        quote: { code: 'sh600519' as StockCode, name: '茅台', price: 100, change: 1, changePercent: 0.5, amount: 1 }
      }
    },
    counts: { fresh: 0, cached: 1, missing: 0 },
    attemptedAt: 0,
    succeededAt: 0,
    generation: 0
  };
  const state = stateWith(stocks, { quotes });
  const [vm] = selectVisibleStocks(state);
  assert.equal(vm.status, 'cached');
  assert.ok(vm.staleLabel.length > 0);
});

test('selectVisibleStocks handles missing quote with dash price', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const state = stateWith(stocks, { quotes: emptySnapshot() });
  const [vm] = selectVisibleStocks(state);
  assert.equal(vm.status, 'missing');
  assert.equal(vm.price, null);
  assert.equal(vm.displayPrice, '--');
});

// ===== selectGroupTabs =====

test('selectGroupTabs returns tabs ordered by group.order', () => {
  const stocks: Stock[] = [];
  const base = createInitialState();
  const state: AppState = {
    ...base,
    domain: {
      ...base.domain,
      userData: {
        schemaVersion: 2,
        groups: [
          { groupId: G1, name: '自选', order: 2, isDefault: false, createdAt: 0, updatedAt: 0 },
          { groupId: G_ALL, name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }
        ],
        watchlist: stocks,
        boardConfig: {}
      }
    },
    view: { ...base.view, currentGroupId: G_ALL }
  };
  const tabs = selectGroupTabs(state);
  assert.deepEqual(tabs.map((t) => t.groupId), [G_ALL, G1]);
  assert.equal(tabs[0].isActive, true);
  assert.equal(tabs[1].isActive, false);
});

// ===== selectToolbar =====

test('selectToolbar exposes viewMode and counts', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const state = stateWith(stocks, {
    quotes: snapshotFor(stocks),
    boardConfig: { g_all: config({ viewMode: 'grid' }) }
  });
  const toolbar = selectToolbar(state);
  assert.equal(toolbar.viewMode, 'grid');
  assert.equal(toolbar.totalCount, 1);
});

// ===== selectHeader =====

test('selectHeader exposes current group name', () => {
  const base = createInitialState();
  const state: AppState = {
    ...base,
    domain: {
      ...base.domain,
      userData: {
        ...base.domain.userData,
        groups: [{ groupId: G1, name: '科技', order: 0, isDefault: false, createdAt: 0, updatedAt: 0 }]
      }
    },
    view: { ...base.view, currentGroupId: G1 }
  };
  const header = selectHeader(state);
  assert.equal(header.groupName, '科技');
});

// ===== selectBatchToolbar =====

test('selectBatchToolbar is hidden when no selection', () => {
  const toolbar = selectBatchToolbar(createInitialState());
  assert.equal(toolbar.visible, false);
  assert.equal(toolbar.selectedCount, 0);
});

test('selectBatchToolbar is visible with selectedCount when codes selected', () => {
  const state = stateWith([], { selectedCodes: ['sh600519', 'sz000001'] });
  const toolbar = selectBatchToolbar(state);
  assert.equal(toolbar.visible, true);
  assert.equal(toolbar.selectedCount, 2);
});

// ===== selectQuoteStatus =====

test('selectQuoteStatus reflects idle initially', () => {
  const status = selectQuoteStatus(createInitialState());
  assert.equal(status.status, 'idle');
});

test('selectQuoteStatus reflects loading during refresh', () => {
  const base = createInitialState();
  const state: AppState = {
    ...base,
    async: { ...base.async, quoteRefresh: { status: 'loading' } }
  };
  assert.equal(selectQuoteStatus(state).status, 'loading');
});

// ===== selectLiveRegion =====

test('selectLiveRegion surfaces toast message when present', () => {
  const base = createInitialState();
  const state: AppState = {
    ...base,
    overlay: { ...base.overlay, toast: { message: '已保存', kind: 'success' } }
  };
  const region = selectLiveRegion(state);
  assert.equal(region.message, '已保存');
});

test('selectLiveRegion is empty when no toast', () => {
  const region = selectLiveRegion(createInitialState());
  assert.equal(region.message, '');
});
