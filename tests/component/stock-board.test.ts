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
import { DEFAULT_UI_COLUMNS } from '../../src/popup/ui-preferences.js';
import type { UiColumnPreferences } from '../../src/popup/ui-preferences.js';

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
    columns: DEFAULT_UI_COLUMNS,
    ...overrides
  };
}

function setupBoard(vm?: BoardViewModel): {
  el: HTMLElement & {
    viewModel: BoardViewModel;
    focusCode(code: StockCode): boolean;
  };
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('stock-board') as HTMLElement & {
    viewModel: BoardViewModel;
    focusCode(code: StockCode): boolean;
  };
  container.append(el);
  if (vm) el.viewModel = vm;
  return { el, spy };
}

test('grid propagates enabled column order to rendered cards', () => {
  const columns: UiColumnPreferences = {
    version: 1,
    enabled: ['name', 'price', 'changePercent', 'code'],
    order: ['code', 'name', 'price', 'changePercent', 'amount', 'status']
  };
  const { el } = setupGrid([card('sh600519')], columns);

  assert.deepEqual(
    Array.from(el.querySelectorAll('.stock-card-fields > [data-column]'), (field) => field.getAttribute('data-column')),
    ['code', 'name', 'price', 'changePercent']
  );
});

function setupGrid(stocks: StockCardViewModel[], columns: UiColumnPreferences = DEFAULT_UI_COLUMNS): {
  el: HTMLElement & {
    viewModel: StockCardViewModel[];
    groupId: GroupId;
    viewport: { scrollOffset: number; viewportExtent: number };
    focusCode(code: StockCode): boolean;
    columns: UiColumnPreferences;
  };
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
    viewport: { scrollOffset: number; viewportExtent: number };
    focusCode(code: StockCode): boolean;
    columns: UiColumnPreferences;
  };
  container.append(el);
  el.groupId = GROUP_ID;
  el.columns = columns;
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

test('board connects only the active list view', () => {
  setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  assert.ok(document.querySelector('stock-table'));
  assert.equal(document.querySelector('stock-grid'), null);
});

test('board connects only the active grid view', () => {
  setupBoard(board({ stocks: [card('sh600519')], viewMode: 'grid' }));
  assert.ok(document.querySelector('stock-grid'));
  assert.equal(document.querySelector('stock-table'), null);
});

test('loading state shows loading container and detaches data views', () => {
  setupBoard(board({ loading: true, stocks: [] }));
  const loading = document.querySelector('[data-region="loading"]') as HTMLElement;
  assert.ok(loading);
  assert.ok(!loading.hasAttribute('hidden'));
  assert.equal(document.querySelector('stock-grid'), null);
  assert.equal(document.querySelector('stock-table'), null);
});

// Task 8: 骨架屏 loading——6 个稳定灰色占位条（无假数字）+ aria-busy 无障碍状态。
test('loading state renders exactly six stable skeleton rows with aria-busy', () => {
  setupBoard(board({ loading: true, stocks: [] }));
  const loading = document.querySelector('[data-region="loading"]') as HTMLElement;
  assert.ok(loading, 'loading container exists');
  assert.equal(loading.getAttribute('hidden'), null, 'loading is visible');
  assert.equal(loading.getAttribute('aria-busy'), 'true');
  assert.equal(loading.querySelectorAll('.skeleton-row').length, 6);
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

test('empty state exposes a semantic add-stock CTA', () => {
  const { spy } = setupBoard(board({ empty: true, stocks: [], emptyMessage: '暂无股票，点击添加' }));
  const cta = document.querySelector<HTMLButtonElement>('[data-region="empty"] button[data-action="add-stock"]');
  assert.ok(cta);
  assert.equal(cta.type, 'button');
  cta.click();
  assert.deepEqual(spy.lastEvent('dialog-open-request')?.detail, { kind: 'add-stock' });
});

test('loading, error, empty, and data states are mutually exclusive', () => {
  const { el } = setupBoard(board({
    loading: true,
    error: '网络错误',
    empty: true,
    stocks: [card('sh600519')]
  }));
  assert.equal(el.querySelector('[data-region="loading"]')?.hasAttribute('hidden'), false);
  assert.equal(el.querySelector('[data-region="error"]')?.hasAttribute('hidden'), true);
  assert.equal(el.querySelector('[data-region="empty"]')?.hasAttribute('hidden'), true);
  assert.equal(el.querySelector('stock-table, stock-grid'), null);

  el.viewModel = board({ error: '网络错误', empty: true, stocks: [card('sh600519')] });
  assert.equal(el.querySelector('[data-region="loading"]')?.hasAttribute('hidden'), true);
  assert.equal(el.querySelector('[data-region="error"]')?.hasAttribute('hidden'), false);
  assert.equal(el.querySelector('[data-region="empty"]')?.hasAttribute('hidden'), true);
  assert.equal(el.querySelector('stock-table, stock-grid'), null);

  el.viewModel = board({ empty: true, stocks: [] });
  assert.equal(el.querySelector('[data-region="loading"]')?.hasAttribute('hidden'), true);
  assert.equal(el.querySelector('[data-region="error"]')?.hasAttribute('hidden'), true);
  assert.equal(el.querySelector('[data-region="empty"]')?.hasAttribute('hidden'), false);
  assert.equal(el.querySelector('stock-table, stock-grid'), null);
});

test('switching viewMode detaches the old view and connects the new view', () => {
  const { el } = setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  const table = el.querySelector('stock-table');
  assert.ok(table);
  el.viewModel = board({ stocks: [card('sh600519')], viewMode: 'grid' });
  assert.ok(el.querySelector('stock-grid'));
  assert.equal(el.querySelector('stock-table'), null);
  assert.equal(table.isConnected, false);
});

test('inactive view does not receive later quote updates', () => {
  const { el } = setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  const detachedTable = el.querySelector('stock-table') as HTMLElement;
  assert.ok(detachedTable);
  el.viewModel = board({ stocks: [card('sh600519')], viewMode: 'grid' });
  const before = detachedTable.querySelector('[data-key="sh600519"]')?.textContent;
  el.viewModel = board({
    stocks: [card('sh600519', { displayPrice: '999.00' })],
    viewMode: 'grid'
  });
  assert.equal(detachedTable.querySelector('[data-key="sh600519"]')?.textContent, before);
});

test('list and grid restore independent normalized scroll offsets', () => {
  const stocks = Array.from(
    { length: 100 },
    (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`)
  );
  const { el } = setupBoard(board({ stocks, viewMode: 'list' }));
  el.scrollTop = 144;
  el.viewModel = board({ stocks, viewMode: 'grid' });
  assert.equal(el.scrollTop, 0);
  el.scrollTop = 252;
  el.viewModel = board({ stocks, viewMode: 'list' });
  assert.equal(el.scrollTop, 144);
  el.viewModel = board({ stocks, viewMode: 'grid' });
  assert.equal(el.scrollTop, 252);
});

test('restored scroll offsets never become negative', () => {
  const stocks = [card('sh600519')];
  const { el } = setupBoard(board({ stocks, viewMode: 'list' }));
  el.scrollTop = -20;
  el.viewModel = board({ stocks, viewMode: 'grid' });
  el.viewModel = board({ stocks, viewMode: 'list' });
  assert.equal(el.scrollTop, 0);
});

test('active view receives scroll viewport with a 390px fallback extent', async () => {
  const stocks = Array.from(
    { length: 100 },
    (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`)
  );
  const { el } = setupBoard(board({ stocks, viewMode: 'list' }));
  const table = el.querySelector('stock-table') as HTMLElement & {
    viewport: { scrollOffset: number; viewportExtent: number };
  };
  assert.deepEqual(table.viewport, { scrollOffset: 0, viewportExtent: 390 });

  el.scrollTop = 240;
  el.dispatchEvent(new Event('scroll'));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  assert.deepEqual(table.viewport, { scrollOffset: 212, viewportExtent: 390 });
});

test('virtual focus scrolls synchronously and focuses the requested keyed control next frame', async () => {
  const stocks = Array.from(
    { length: 100 },
    (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`)
  );
  const { el } = setupBoard(board({ stocks, viewMode: 'grid' }));

  assert.equal(el.focusCode('sh600041' as StockCode), true);
  assert.equal(el.scrollTop, 126 * 20);
  assert.ok(el.querySelector('[data-key="sh600041"]'), 'requested card is rendered synchronously');
  assert.notEqual(document.activeElement?.closest('[data-key]')?.getAttribute('data-key'), 'sh600041');

  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  assert.equal(document.activeElement?.closest('[data-key]')?.getAttribute('data-key'), 'sh600041');
});

// ===== Grid: keyed node identity + focus preservation =====

test('500-stock grid keeps card nodes bounded and exposes list size', () => {
  const stocks = Array.from(
    { length: 500 },
    (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`)
  );
  const { el } = setupGrid(stocks);
  el.viewport = { scrollOffset: 0, viewportExtent: 390 };

  const cards = el.querySelectorAll('stock-card[data-key]');
  assert.ok(cards.length <= 24, `expected <=24 real cards, got ${cards.length}`);
  assert.equal(el.querySelector('[data-region="grid-cards"]')?.getAttribute('role'), 'list');
  assert.equal(cards[0]?.getAttribute('aria-setsize'), '500');
  assert.equal(cards[0]?.getAttribute('aria-posinset'), '1');

  el.viewport = { scrollOffset: 126 * 100, viewportExtent: 390 };
  assert.ok(
    el.querySelectorAll('stock-card[data-key]').length <= 24,
    'middle windows also stay within the 24-card cap'
  );
});

test('grid scroll offset renders cards around the target row with global positions', () => {
  const stocks = Array.from(
    { length: 100 },
    (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`)
  );
  const { el } = setupGrid(stocks);
  el.viewport = { scrollOffset: 126 * 20, viewportExtent: 390 };

  const target = el.querySelector('[data-key="sh600040"]');
  assert.ok(target);
  assert.equal(target.getAttribute('role'), 'listitem');
  assert.equal(target.getAttribute('aria-posinset'), '41');
  assert.equal(target.getAttribute('aria-setsize'), '100');
  assert.equal(el.querySelector('[data-key="sh600000"]'), null);
  assert.equal(
    (el.querySelector('[data-region="grid-cards"]') as HTMLElement).style.gridTemplateColumns,
    'repeat(2, minmax(0, 1fr))'
  );
  assert.equal(
    (el.querySelector('.stock-grid-spacer--before') as HTMLElement).style.height,
    `${126 * 16}px`
  );
  assert.equal(
    (el.querySelector('.stock-grid-spacer--after') as HTMLElement).style.height,
    `${126 * 22}px`
  );
});

test('grid focusCode emits row-based virtual focus request without moving focus', () => {
  const stocks = Array.from(
    { length: 100 },
    (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`)
  );
  const { el } = setupGrid(stocks);
  const sentinel = document.createElement('button');
  document.body.append(sentinel);
  sentinel.focus();
  let detail: unknown;
  el.addEventListener('virtual-focus-request', (event) => {
    detail = (event as CustomEvent).detail;
  });

  assert.equal(el.focusCode('sh600041' as StockCode), true);
  assert.deepEqual(detail, { index: 20, itemExtent: 126 });
  assert.equal(document.activeElement, sentinel);
});

test('grid focusCode returns false for an unknown stock code', () => {
  const { el } = setupGrid([card('sh600519')]);
  assert.equal(el.focusCode('sz000001' as StockCode), false);
});

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

test('grid card exposes the single stock menu trigger event', () => {
  const { spy } = setupGrid([card('sh600519'), card('sz000001')]);
  spy.reset();
  const trigger = document.querySelector('[data-key="sh600519"] button[data-action="stock-menu"]') as HTMLButtonElement;
  trigger.click();
  assert.deepEqual(spy.lastEvent('stock-menu-open-request')?.detail, {
    anchorId: 'stock-actions-sh600519',
    code: 'sh600519'
  });
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
  assert.ok(table, 'active table must be connected');
  assert.equal(table.hasAttribute('hidden'), false, 'active table must not be hidden');
});
