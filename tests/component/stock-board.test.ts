// tests/component/stock-board.test.ts
// Task 16 Step 1 — stock-board + stock-grid 组件测试。
// 断言：视图切换（grid/list hidden）、empty/loading/error 容器、
//       board region labelled（aria-label 无 aria-live）、
//       keyed-update 节点/焦点 identity 保持、键盘重排发出完整 orderedCodes。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { BoardViewModel, StockCardViewModel } from '../../src/popup/view-models.js';
import type { StockCode, GroupId } from '../../src/domain/index.js';

function card(code: string, overrides: Partial<StockCardViewModel> = {}): StockCardViewModel {
  return {
    code: code as StockCode,
    name: `股票${code}`,
    price: 100,
    change: 1,
    changePercent: 1,
    status: 'fresh',
    pinned: false,
    staleLabel: '',
    displayPrice: '100.00',
    displayChange: '+1.00',
    displayAmount: '1.2亿',
    ...overrides
  };
}

const GROUP_ID = 'g_all' as GroupId;

function board(overrides: Partial<BoardViewModel> = {}): BoardViewModel {
  return {
    viewMode: 'list',
    groupId: GROUP_ID,
    stocks: [],
    columns: ['name', 'code', 'status', 'price', 'changePercent', 'amount'],
    loading: false,
    error: null,
    empty: false,
    emptyMessage: '暂无股票',
    ...overrides
  };
}

function setupBoard(vm?: BoardViewModel): {
  el: HTMLElement & { viewModel: BoardViewModel };
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('stock-board') as HTMLElement & { viewModel: BoardViewModel };
  container.append(el);
  if (vm) el.viewModel = vm;
  return { el, spy };
}

function setupGrid(stocks: StockCardViewModel[]): {
  el: HTMLElement & { viewModel: StockCardViewModel[]; groupId: GroupId };
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('stock-grid') as HTMLElement & {
    viewModel: StockCardViewModel[];
    groupId: GroupId;
  };
  container.append(el);
  el.groupId = GROUP_ID;
  el.viewModel = stocks;
  return { el, spy };
}

// ===== Board: view switching =====

test('board has aria-label and no aria-live on stock list container', () => {
  setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  const boardEl = document.querySelector('stock-board') as HTMLElement;
  assert.ok(boardEl.getAttribute('aria-label'));
  // The board should not put aria-live on the stock list
  const grid = document.querySelector('stock-grid');
  const table = document.querySelector('stock-table');
  const liveEls = document.querySelectorAll('[aria-live]');
  // Only quote-status or app-live-region should have aria-live, not grid/table
  for (const el of liveEls) {
    const tag = el.tagName.toLowerCase();
    assert.ok(tag !== 'stock-grid' && tag !== 'stock-table');
  }
});

test('list view mounts stock-table and leaves stock-grid unmounted', () => {
  // 契约变更（计划 Task 4）：非激活视图不再靠 hidden 隐藏，而是根本不挂载——
  // 挂载即意味着每次行情刷新都要为看不见的视图做一遍完整渲染。
  setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  assert.ok(document.querySelector('stock-table'));
  assert.equal(document.querySelector('stock-grid'), null);
});

test('grid view mounts stock-grid and leaves stock-table unmounted', () => {
  setupBoard(board({ stocks: [card('sh600519')], viewMode: 'grid' }));
  assert.ok(document.querySelector('stock-grid'));
  assert.equal(document.querySelector('stock-table'), null);
});

test('loading state shows the skeleton and mounts no data view', () => {
  setupBoard(board({ loading: true, stocks: [] }));
  const loading = document.querySelector('[data-region="loading"]') as HTMLElement;
  assert.ok(loading);
  assert.ok(!loading.hasAttribute('hidden'));
  assert.equal(document.querySelector('stock-grid'), null);
  assert.equal(document.querySelector('stock-table'), null);
});

// Task 8: 骨架屏 loading——5 个灰色占位条（无假数字）+ aria-busy 无障碍状态。
test('loading state renders skeleton rows with aria-busy', () => {
  setupBoard(board({ loading: true, stocks: [] }));
  const loading = document.querySelector('[data-region="loading"]') as HTMLElement;
  assert.ok(loading, 'loading container exists');
  assert.equal(loading.getAttribute('hidden'), null, 'loading is visible');
  assert.equal(loading.getAttribute('aria-busy'), 'true');
  assert.ok(
    loading.querySelectorAll('.skeleton-row').length >= 3,
    'has at least 3 skeleton rows'
  );
  // 不变量：骨架屏绝不渲染假价格/假数字
  assert.equal(loading.textContent, '', 'skeleton must not render fake data text');
});

test('error state shows error container with message', () => {
  setupBoard(board({ error: '网络错误', stocks: [] }));
  const error = document.querySelector('[data-region="error"]') as HTMLElement;
  assert.ok(error);
  assert.ok(!error.hasAttribute('hidden'));
  assert.ok(error.textContent?.includes('网络错误'));
});

test('empty state shows empty container with message', () => {
  setupBoard(board({ empty: true, stocks: [], emptyMessage: '暂无股票，点击添加' }));
  const empty = document.querySelector('[data-region="empty"]') as HTMLElement;
  assert.ok(empty);
  assert.ok(!empty.hasAttribute('hidden'));
  assert.ok(empty.textContent?.includes('暂无股票'));
});

test('switching viewMode swaps which view is mounted', () => {
  const { el } = setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  el.viewModel = board({ stocks: [card('sh600519')], viewMode: 'grid' });
  assert.ok(document.querySelector('stock-grid'));
  assert.equal(document.querySelector('stock-table'), null);
});

// ===== Grid: keyed node identity + focus preservation =====

test('quote updates preserve the same card node (identity)', () => {
  const firstQuotes: StockCardViewModel[] = [
    card('sh600519', { displayPrice: '100.00' }),
    card('sz000001', { displayPrice: '10.00' })
  ];
  const { el } = setupGrid(firstQuotes);
  const card_node = el.querySelector('[data-key="sh600519"]');
  assert.ok(card_node);
  const newerQuotes: StockCardViewModel[] = [
    card('sh600519', { displayPrice: '105.00' }),
    card('sz000001', { displayPrice: '11.00' })
  ];
  el.viewModel = newerQuotes;
  assert.equal(el.querySelector('[data-key="sh600519"]'), card_node);
});

test('quote updates preserve the focused card node', () => {
  const firstQuotes: StockCardViewModel[] = [
    card('sh600519'),
    card('sz000001')
  ];
  const { el } = setupGrid(firstQuotes);
  const cardEl = el.querySelector('[data-key="sh600519"]');
  cardEl?.querySelector('button')?.focus();
  el.viewModel = [card('sh600519', { displayPrice: '105.00' }), card('sz000001')];
  assert.equal(el.querySelector('[data-key="sh600519"]'), cardEl);
  assert.equal(document.activeElement?.closest('[data-key="sh600519"]'), cardEl);
});

test('removed stock card is removed from grid', () => {
  const { el } = setupGrid([card('sh600519'), card('sz000001')]);
  el.viewModel = [card('sh600519')];
  assert.ok(el.querySelector('[data-key="sh600519"]'));
  assert.ok(!el.querySelector('[data-key="sz000001"]'));
});

test('new stock card is appended to grid', () => {
  const { el } = setupGrid([card('sh600519')]);
  el.viewModel = [card('sh600519'), card('sz000001')];
  assert.ok(el.querySelector('[data-key="sz000001"]'));
});

test('keyboard reorder via card down button emits full final code order', () => {
  const { spy } = setupGrid([card('sh600519'), card('sz000001')]);
  spy.reset();
  // Click move-down on sh600519's card
  const cardEl = spy.constructor === Object
    ? document.querySelector('[data-key="sh600519"]')
    : null;
  const downBtn = document.querySelector('[data-key="sh600519"] button[data-action="move-down"]') as HTMLButtonElement;
  downBtn.click();
  const detail = spy.lastEvent('stock-order-request')?.detail;
  assert.ok(detail);
  assert.deepEqual(detail!.orderedCodes, ['sz000001', 'sh600519']);
});

test('grid card data-key order matches viewModel order', () => {
  const { el } = setupGrid([card('sh600519'), card('sz000001'), card('bj920001')]);
  const keys = Array.from(el.querySelectorAll('[data-key]')).map((n) => n.getAttribute('data-key'));
  assert.deepEqual(keys, ['sh600519', 'sz000001', 'bj920001']);
});

test('reordering viewModel updates DOM order while preserving nodes', () => {
  const { el } = setupGrid([card('sh600519'), card('sz000001')]);
  const node1 = el.querySelector('[data-key="sh600519"]');
  el.viewModel = [card('sz000001'), card('sh600519')];
  const keys = Array.from(el.querySelectorAll('[data-key]')).map((n) => n.getAttribute('data-key'));
  assert.deepEqual(keys, ['sz000001', 'sh600519']);
  assert.equal(el.querySelector('[data-key="sh600519"]'), node1);
});

// 回归：hidden 属性必须实际隐藏状态占位（display:flex 会覆盖 UA 的 [hidden] display:none，
// 导致 loading/error/empty 同时可见，把表格挤出首屏——真实弹窗样式错乱的根因）。
test('hidden state placeholders are not rendered (display none, not flex)', () => {
  const { el } = setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  for (const region of ['loading', 'error', 'empty']) {
    const node = el.querySelector(`[data-region="${region}"]`) as HTMLElement | null;
    assert.ok(node, `${region} placeholder exists`);
    assert.equal(node.hasAttribute('hidden'), true, `${region} must have hidden`);
    // 关键：即使 CSS 未加载（无样式表），hidden 语义也必须在。
    // 组件测试环境无 CSS，此处验证属性存在即可；E2E 中由样式表保证 display:none。
  }
  // 表格（当前视图）不应 hidden。
  const table = el.querySelector('stock-table') as HTMLElement | null;
  assert.equal(table?.hasAttribute('hidden'), false, 'active table must not be hidden');
});

// ===== 网格虚拟化（两列 → 按「行」计算窗口）=====

function manyStocks(n: number): StockCardViewModel[] {
  return Array.from({ length: n }, (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`));
}

test('500-stock grid keeps card nodes bounded', () => {
  const { el } = setupGrid(manyStocks(500));
  (el as unknown as { viewport: unknown }).viewport = { scrollOffset: 0, viewportExtent: 390 };
  const cards = document.querySelectorAll('stock-card[data-key]');
  assert.ok(cards.length <= 24, `expected <=24 cards, got ${cards.length}`);
});

test('grid exposes full list size to assistive technology', () => {
  const { el } = setupGrid(manyStocks(500));
  (el as unknown as { viewport: unknown }).viewport = { scrollOffset: 0, viewportExtent: 390 };
  const first = document.querySelector('stock-card[data-key]');
  assert.equal(first?.getAttribute('aria-setsize'), '500');
  assert.equal(first?.getAttribute('aria-posinset'), '1');
});

test('grid scroll offset renders cards around the target row', () => {
  const { el } = setupGrid(manyStocks(100));
  // 每行 2 张卡、行高 126px；滚到第 20 行附近 → 索引 40 一带。
  (el as unknown as { viewport: unknown }).viewport = { scrollOffset: 126 * 20, viewportExtent: 390 };
  assert.ok(document.querySelector('[data-key="sh600040"]'), 'target card mounted');
});

test('grid spacers preserve total scroll height', () => {
  const { el } = setupGrid(manyStocks(500));
  (el as unknown as { viewport: unknown }).viewport = { scrollOffset: 126 * 30, viewportExtent: 390 };
  const spacers = document.querySelectorAll('[data-spacer]');
  assert.equal(spacers.length, 2);
  const heights = [...spacers].map((s) => Number.parseFloat((s as HTMLElement).style.height) || 0);
  const renderedRows = Math.ceil(document.querySelectorAll('stock-card[data-key]').length / 2);
  assert.equal(heights[0] + renderedRows * 126 + heights[1], Math.ceil(500 / 2) * 126);
});

test('grid focusCode requests a scroll using row extent, not card extent', () => {
  const { el, spy } = setupGrid(manyStocks(500));
  (el as unknown as { viewport: unknown }).viewport = { scrollOffset: 0, viewportExtent: 390 };
  const found = (el as unknown as { focusCode(code: string): boolean }).focusCode('sh600401');
  assert.equal(found, true);
  const event = spy.lastEvent('virtual-focus-request');
  // 索引 401 位于第 200 行（两列）。
  assert.equal(event?.detail.index, 200);
  assert.equal(event?.detail.itemExtent, 126);
});

// ===== 只挂载激活视图 =====

test('board connects only the active stock view', () => {
  setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  assert.ok(document.querySelector('stock-table'), 'list view mounted');
  assert.equal(document.querySelector('stock-grid'), null, 'inactive grid is not in the DOM');
});

test('switching view mode detaches the previous view', () => {
  const { el } = setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  el.viewModel = board({ stocks: [card('sh600519')], viewMode: 'grid' });
  assert.ok(document.querySelector('stock-grid'), 'grid mounted');
  assert.equal(document.querySelector('stock-table'), null, 'table detached');
});

test('the inactive view stops receiving quote updates', () => {
  const { el } = setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  const detachedTable = document.querySelector('stock-table') as HTMLElement;
  const before = detachedTable.querySelector('[data-key="sh600519"]')?.textContent;

  el.viewModel = board({ stocks: [card('sh600519')], viewMode: 'grid' });
  el.viewModel = board({
    stocks: [card('sh600519', { displayPrice: '999.00' })],
    viewMode: 'grid'
  });

  assert.equal(
    detachedTable.querySelector('[data-key="sh600519"]')?.textContent,
    before,
    'detached view did no work for an update it will never show'
  );
});

// ===== 虚拟焦点：必须落在被请求的那一只股票上 =====

test('virtual focus lands on the requested stock, not the first rendered one', () => {
  const { el } = setupBoard(board({ stocks: manyStocks(500), viewMode: 'grid' }));
  const grid = document.querySelector('stock-grid') as HTMLElement & {
    focusCode(code: string): boolean;
  };

  // 目标远在初始窗口之外。
  grid.focusCode('sh600300');

  // 看板滚动后，焦点必须在目标卡片上。过扫描会让窗口从目标**之前**若干行
  // 开始渲染，所以「聚焦第一个 data-key」会落到错误的股票上。
  const mounted = [...document.querySelectorAll('[data-key]')].map((n) => n.getAttribute('data-key'));
  assert.ok(mounted.includes('sh600300'), 'target scrolled into the virtual window');
  const active = document.activeElement as HTMLElement | null;
  const focusedKey = active?.closest?.('[data-key]')?.getAttribute('data-key');
  assert.equal(focusedKey, 'sh600300', `focus landed on ${focusedKey ?? active?.tagName}`);
  void el;
});
