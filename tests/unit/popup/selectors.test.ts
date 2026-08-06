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
  selectLiveRegion,
  selectColumnPanel,
  selectDialog
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
      selectionMode: (opts?.selectedCodes?.length ?? 0) > 0,
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
  assert.equal(cfg.viewMode, 'grid');
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

test('selectVisibleStocks projects open/high/low/prevClose/volume into ViewModel', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const quotes: QuoteSnapshot = {
    results: {
      ['sh600519' as StockCode]: {
        code: 'sh600519' as StockCode,
        status: 'fresh',
        source: 'eastmoney',
        provider: 'eastmoney',
        fetchedAt: 0,
        error: null,
        quote: { code: 'sh600519' as StockCode, name: '茅台', price: 100, change: 1, changePercent: 0.5, amount: 1000, open: 99, high: 101, low: 98.5, prevClose: 99.5, volume: 28566 }
      }
    },
    counts: { fresh: 1, cached: 0, missing: 0 },
    attemptedAt: 0,
    succeededAt: 0,
    generation: 0
  };
  const state = stateWith(stocks, { quotes });
  const [vm] = selectVisibleStocks(state);
  assert.equal(vm.displayOpen, '99.00');
  assert.equal(vm.displayHigh, '101.00');
  assert.equal(vm.displayLow, '98.50');
  assert.equal(vm.displayPrevClose, '99.50');
  assert.equal(vm.displayVolume, '2.9万');
});

test('selectVisibleStocks shows dashes for missing detail fields', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const state = stateWith(stocks, { quotes: snapshotFor(stocks) });
  const [vm] = selectVisibleStocks(state);
  assert.equal(vm.displayOpen, '--');
  assert.equal(vm.displayHigh, '--');
  assert.equal(vm.displayLow, '--');
  assert.equal(vm.displayPrevClose, '--');
  assert.equal(vm.displayVolume, '--');
});

test('selectVisibleStocks masks price-family detail fields when priceHidden', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const quotes: QuoteSnapshot = {
    results: {
      ['sh600519' as StockCode]: {
        code: 'sh600519' as StockCode,
        status: 'fresh',
        source: 'eastmoney',
        provider: 'eastmoney',
        fetchedAt: 0,
        error: null,
        quote: { code: 'sh600519' as StockCode, name: '茅台', price: 100, change: 1, changePercent: 0.5, amount: 1000, open: 99, high: 101, low: 98.5, prevClose: 99.5, volume: 28566 }
      }
    },
    counts: { fresh: 1, cached: 0, missing: 0 },
    attemptedAt: 0,
    succeededAt: 0,
    generation: 0
  };
  const state = stateWith(stocks, {
    quotes,
    boardConfig: { g_all: config({ priceHidden: true }) }
  });
  const [vm] = selectVisibleStocks(state);
  // 价格类字段掩码；成交量不是价格，不掩码。
  assert.equal(vm.displayOpen, '****');
  assert.equal(vm.displayHigh, '****');
  assert.equal(vm.displayLow, '****');
  assert.equal(vm.displayPrevClose, '****');
  assert.equal(vm.displayVolume, '2.9万');
});

test('selectVisibleStocks projects ratio/cap/limit detail fields', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const quotes: QuoteSnapshot = {
    results: {
      ['sh600519' as StockCode]: {
        code: 'sh600519' as StockCode,
        status: 'fresh',
        source: 'eastmoney',
        provider: 'eastmoney',
        fetchedAt: 0,
        error: null,
        quote: {
          code: 'sh600519' as StockCode, name: '茅台', price: 1500, change: 18, changePercent: 1.2, amount: 3754515788,
          turnoverRate: 0.2, amplitude: 1.33, volumeRatio: 0.52, pe: 19.78, pb: 7.02,
          totalMarketCap: 1635794000000, floatMarketCap: 1635794000000, limitUp: 1650, limitDown: 1350
        }
      }
    },
    counts: { fresh: 1, cached: 0, missing: 0 },
    attemptedAt: 0,
    succeededAt: 0,
    generation: 0
  };
  const state = stateWith(stocks, { quotes });
  const [vm] = selectVisibleStocks(state);
  assert.equal(vm.displayTurnoverRate, '0.20%');
  assert.equal(vm.displayAmplitude, '1.33%');
  assert.equal(vm.displayVolumeRatio, '0.52');
  assert.equal(vm.displayPe, '19.78');
  assert.equal(vm.displayPb, '7.02');
  assert.equal(vm.displayTotalMarketCap, '1.64万亿');
  assert.equal(vm.displayFloatMarketCap, '1.64万亿');
  assert.equal(vm.displayLimitUp, '1650.00');
  assert.equal(vm.displayLimitDown, '1350.00');
});

test('selectVisibleStocks shows dashes for missing ratio/cap/limit fields', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const state = stateWith(stocks, { quotes: snapshotFor(stocks) });
  const [vm] = selectVisibleStocks(state);
  assert.equal(vm.displayTurnoverRate, '--');
  assert.equal(vm.displayAmplitude, '--');
  assert.equal(vm.displayVolumeRatio, '--');
  assert.equal(vm.displayPe, '--');
  assert.equal(vm.displayPb, '--');
  assert.equal(vm.displayTotalMarketCap, '--');
  assert.equal(vm.displayFloatMarketCap, '--');
  assert.equal(vm.displayLimitUp, '--');
  assert.equal(vm.displayLimitDown, '--');
});

test('selectVisibleStocks masks limit prices when priceHidden but not ratios', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const quotes: QuoteSnapshot = {
    results: {
      ['sh600519' as StockCode]: {
        code: 'sh600519' as StockCode,
        status: 'fresh',
        source: 'eastmoney',
        provider: 'eastmoney',
        fetchedAt: 0,
        error: null,
        quote: {
          code: 'sh600519' as StockCode, name: '茅台', price: 1500, change: 18, changePercent: 1.2, amount: 1000,
          turnoverRate: 0.2, limitUp: 1650, limitDown: 1350
        }
      }
    },
    counts: { fresh: 1, cached: 0, missing: 0 },
    attemptedAt: 0,
    succeededAt: 0,
    generation: 0
  };
  const state = stateWith(stocks, {
    quotes,
    boardConfig: { g_all: config({ priceHidden: true }) }
  });
  const [vm] = selectVisibleStocks(state);
  // 涨停/跌停是价格类字段，随价格隐藏掩码；比率类不受影响。
  assert.equal(vm.displayLimitUp, '****');
  assert.equal(vm.displayLimitDown, '****');
  assert.equal(vm.displayTurnoverRate, '0.20%');
});

test('selectVisibleStocks formats amount with yi as the smallest unit', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const quotes: QuoteSnapshot = {
    results: {
      ['sh600519' as StockCode]: {
        code: 'sh600519' as StockCode,
        status: 'fresh',
        source: 'eastmoney',
        provider: 'eastmoney',
        fetchedAt: 0,
        error: null,
        quote: { code: 'sh600519' as StockCode, name: '茅台', price: 100, change: 1, changePercent: 0.5, amount: 30_000_000 }
      }
    },
    counts: { fresh: 1, cached: 0, missing: 0 },
    attemptedAt: 0,
    succeededAt: 0,
    generation: 0
  };
  const state = stateWith(stocks, { quotes });
  const [vm] = selectVisibleStocks(state);
  // 3000 万（0.3 亿）——不再降级到「万」单位。
  assert.equal(vm.displayAmount, '0.3亿');
});

test('selectVisibleStocks keeps yi unit for amounts above one yi', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const quotes: QuoteSnapshot = {
    results: {
      ['sh600519' as StockCode]: {
        code: 'sh600519' as StockCode,
        status: 'fresh',
        source: 'eastmoney',
        provider: 'eastmoney',
        fetchedAt: 0,
        error: null,
        quote: { code: 'sh600519' as StockCode, name: '茅台', price: 100, change: 1, changePercent: 0.5, amount: 1_200_000_000 }
      }
    },
    counts: { fresh: 1, cached: 0, missing: 0 },
    attemptedAt: 0,
    succeededAt: 0,
    generation: 0
  };
  const state = stateWith(stocks, { quotes });
  const [vm] = selectVisibleStocks(state);
  assert.equal(vm.displayAmount, '12.0亿');
});

test('selectVisibleStocks keeps precision for sub-yi amounts (no 0.0亿)', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const quotes: QuoteSnapshot = {
    results: {
      ['sh600519' as StockCode]: {
        code: 'sh600519' as StockCode,
        status: 'fresh',
        source: 'eastmoney',
        provider: 'eastmoney',
        fetchedAt: 0,
        error: null,
        quote: { code: 'sh600519' as StockCode, name: '茅台', price: 100, change: 1, changePercent: 0.5, amount: 4_000_000 }
      }
    },
    counts: { fresh: 1, cached: 0, missing: 0 },
    attemptedAt: 0,
    succeededAt: 0,
    generation: 0
  };
  const state = stateWith(stocks, { quotes });
  const [vm] = selectVisibleStocks(state);
  // 400 万 → 0.04亿（保留两位小数），不能显示成「0.0亿」读作零成交。
  assert.equal(vm.displayAmount, '0.04亿');
});

test('selectVisibleStocks falls back to wan for tiny amounts', () => {
  const stocks = [mkStock('sh600519', '茅台')];
  const quotes: QuoteSnapshot = {
    results: {
      ['sh600519' as StockCode]: {
        code: 'sh600519' as StockCode,
        status: 'fresh',
        source: 'eastmoney',
        provider: 'eastmoney',
        fetchedAt: 0,
        error: null,
        quote: { code: 'sh600519' as StockCode, name: '茅台', price: 100, change: 1, changePercent: 0.5, amount: 900_000 }
      }
    },
    counts: { fresh: 1, cached: 0, missing: 0 },
    attemptedAt: 0,
    succeededAt: 0,
    generation: 0
  };
  const state = stateWith(stocks, { quotes });
  const [vm] = selectVisibleStocks(state);
  // 90 万低于 100 万——用万单位避免 0.00亿。
  assert.equal(vm.displayAmount, '90万');
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

// ===== selectDialog =====

test('selectDialog supplies groups for rename-group so clash validation works', () => {
  const state = stateWith([mkStock('sh600519', '贵州茅台')]);
  state.overlay = {
    ...state.overlay,
    dialog: { kind: 'rename-group', groupId: 'g_tech' as GroupId, currentName: '科技' }
  };
  const vm = selectDialog(state);
  assert.equal(vm.kind, 'rename-group');
  // 分组列表必须带上——否则 app-dialog-host 的重名提前校验（vm.groups.some）恒为 false。
  assert.ok(vm.groups.some((g) => g.groupId === 'g_all'), 'rename 对话框需要分组列表供重名校验');
});

test('selectDialog rename-group excludes the target group from clash candidates', () => {
  const state = stateWith([mkStock('sh600519', '贵州茅台')]);
  state.overlay = {
    ...state.overlay,
    dialog: { kind: 'rename-group', groupId: 'g_tech' as GroupId, currentName: '科技' }
  };
  const vm = selectDialog(state);
  assert.equal(vm.kind, 'rename-group');
  // 目标组自身不算重名——改名不改名都不会把自己判成冲突。
  assert.ok(!vm.groups.some((g) => g.groupId === 'g_tech'));
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

// ===== selectColumnPanel =====

test('selectColumnPanel excludes the locked name column', () => {
  const state = stateWith([mkStock('sh600519', '贵州茅台')]);
  state.view = {
    ...state.view,
    columns: {
      version: 1,
      enabled: ['name', 'code', 'status', 'price', 'changePercent', 'amount'],
      order: ['amount', 'name', 'code', 'price', 'changePercent', 'status']
    }
  };
  const vm = selectColumnPanel(state);
  // name 锁定在列表最前、不进面板；主列保持相对顺序，副标题固定尾部。
  assert.deepEqual(vm.columnOrder, ['amount', 'price', 'changePercent', 'code', 'status']);
  assert.ok(!vm.columns.some((c) => c.key === 'name'), 'panel must not expose the locked column');
  assert.equal(vm.columns.length, 5);
});

test('selectColumnPanel keeps relative order of main columns', () => {
  const state = stateWith([mkStock('sh600519', '贵州茅台')]);
  state.view = {
    ...state.view,
    columns: {
      version: 1,
      enabled: ['name', 'price', 'changePercent', 'amount', 'code', 'status'],
      order: ['changePercent', 'name', 'amount', 'price', 'code', 'status']
    }
  };
  const vm = selectColumnPanel(state);
  assert.deepEqual(vm.columnOrder, ['changePercent', 'amount', 'price', 'code', 'status']);
});

test('selectColumnPanel reflects enabled set on configurable columns', () => {
  const state = stateWith([mkStock('sh600519', '贵州茅台')]);
  state.view = {
    ...state.view,
    columns: {
      version: 1,
      enabled: ['name', 'price', 'changePercent', 'amount'],
      order: ['name', 'price', 'changePercent', 'amount', 'code', 'status']
    }
  };
  const vm = selectColumnPanel(state);
  const code = vm.columns.find((c) => c.key === 'code');
  const status = vm.columns.find((c) => c.key === 'status');
  assert.equal(code?.enabled, false);
  assert.equal(status?.enabled, false);
  assert.equal(vm.columns.find((c) => c.key === 'price')?.enabled, true);
});
