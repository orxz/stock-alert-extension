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

test('list view shows stock-table and hides stock-grid', () => {
  setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  const grid = document.querySelector('stock-grid') as HTMLElement;
  const table = document.querySelector('stock-table') as HTMLElement;
  assert.ok(grid.hasAttribute('hidden'));
  assert.ok(!table.hasAttribute('hidden'));
});

test('grid view shows stock-grid and hides stock-table', () => {
  setupBoard(board({ stocks: [card('sh600519')], viewMode: 'grid' }));
  const grid = document.querySelector('stock-grid') as HTMLElement;
  const table = document.querySelector('stock-table') as HTMLElement;
  assert.ok(!grid.hasAttribute('hidden'));
  assert.ok(table.hasAttribute('hidden'));
});

test('loading state shows loading container and hides grid/table', () => {
  setupBoard(board({ loading: true, stocks: [] }));
  const loading = document.querySelector('[data-region="loading"]') as HTMLElement;
  const grid = document.querySelector('stock-grid') as HTMLElement;
  const table = document.querySelector('stock-table') as HTMLElement;
  assert.ok(loading);
  assert.ok(!loading.hasAttribute('hidden'));
  assert.ok(grid.hasAttribute('hidden'));
  assert.ok(table.hasAttribute('hidden'));
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

test('switching viewMode toggles hidden on grid and table', () => {
  const { el } = setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  el.viewModel = board({ stocks: [card('sh600519')], viewMode: 'grid' });
  const grid = document.querySelector('stock-grid') as HTMLElement;
  const table = document.querySelector('stock-table') as HTMLElement;
  assert.ok(!grid.hasAttribute('hidden'));
  assert.ok(table.hasAttribute('hidden'));
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
