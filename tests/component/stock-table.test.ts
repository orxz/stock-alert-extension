// tests/component/stock-table.test.ts
// Task 16 Step 1 — stock-table 组件测试。
// 断言：real table/thead/tbody 结构、header 按钮 aria-sort、
//       行 keyed by stock code、节点 identity 保持、header 点击排序。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { StockCardViewModel } from '../../src/popup/view-models.js';
import type { StockCode, GroupId, SortField, SortDirection } from '../../src/domain/index.js';
import type { VirtualViewport } from '../../src/popup/virtualization/virtual-window.js';
import { DEFAULT_UI_COLUMNS, type UiColumnPreferences } from '../../src/popup/ui-preferences.js';

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

interface TestStockTableElement extends HTMLElement {
  viewModel: StockCardViewModel[];
  groupId: GroupId;
  sortField: SortField;
  sortDirection: SortDirection;
  viewport: VirtualViewport;
  focusCode(code: StockCode): boolean;
  columns: UiColumnPreferences;
}

function setupTable(stocks: StockCardViewModel[], sortField: SortField = 'manual', sortDirection: SortDirection = 'asc', columns: UiColumnPreferences = DEFAULT_UI_COLUMNS): {
  el: TestStockTableElement;
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('stock-table') as TestStockTableElement;
  container.append(el);
  el.groupId = GROUP_ID;
  el.columns = columns;
  el.sortField = sortField;
  el.sortDirection = sortDirection;
  el.viewModel = stocks;
  return { el, spy };
}

test('enabled column order controls table headers and row cells', () => {
  const columns: UiColumnPreferences = {
    version: 1,
    enabled: ['name', 'price', 'changePercent', 'status'],
    order: ['status', 'name', 'changePercent', 'price', 'code', 'amount']
  };
  setupTable([card('sh600519')], 'manual', 'asc', columns);

  assert.deepEqual(
    Array.from(document.querySelectorAll('thead th[data-column]'), (cell) => cell.getAttribute('data-column')),
    ['status', 'name', 'changePercent', 'price']
  );
  assert.deepEqual(
    Array.from(document.querySelectorAll('tbody tr[data-key] td[data-column]'), (cell) => cell.getAttribute('data-column')),
    ['status', 'name', 'changePercent', 'price']
  );
});

test('renders a real table element', () => {
  setupTable([card('sh600519')]);
  assert.ok(document.querySelector('table'));
});

test('table has thead and tbody', () => {
  setupTable([card('sh600519')]);
  assert.ok(document.querySelector('thead'));
  assert.ok(document.querySelector('tbody'));
});

test('header cells contain buttons for sortable columns', () => {
  setupTable([card('sh600519')]);
  const headerBtns = document.querySelectorAll('thead button');
  assert.ok(headerBtns.length >= 3);
});

test('header buttons have aria-sort', () => {
  setupTable([card('sh600519')], 'price', 'desc');
  const ths = document.querySelectorAll('thead th');
  for (const th of ths) {
    // Each sortable th should have aria-sort or contain a button with aria-sort context
    const sortVal = th.getAttribute('aria-sort');
    if (sortVal) {
      assert.ok(['ascending', 'descending', 'none'].includes(sortVal));
    }
  }
  // At least one column should reflect the current sort
  const sorted = document.querySelectorAll('th[aria-sort="descending"], th[aria-sort="ascending"]');
  assert.ok(sorted.length >= 1);
});

test('body rows are keyed by stock code via data-key', () => {
  setupTable([card('sh600519'), card('sz000001')]);
  const rows = document.querySelectorAll('tbody tr[data-key]');
  assert.equal(rows.length, 2);
  assert.ok(document.querySelector('tbody tr[data-key="sh600519"]'));
  assert.ok(document.querySelector('tbody tr[data-key="sz000001"]'));
});

test('row displays stock name and price', () => {
  setupTable([card('sh600519', { name: '贵州茅台', displayPrice: '1688.00' })]);
  const row = document.querySelector('tbody tr[data-key="sh600519"]') as HTMLElement;
  assert.ok(row.textContent?.includes('贵州茅台'));
  assert.ok(row.textContent?.includes('1688.00'));
});

test('each table row renders exactly one deterministic stock menu trigger', () => {
  setupTable([card('sh600519', { name: '贵州茅台' }), card('sz000001', { name: '平安银行' })]);
  const rows = document.querySelectorAll('tbody tr[data-key]');
  for (const row of rows) {
    assert.equal(row.querySelectorAll('button[data-action="stock-menu"]').length, 1);
    assert.equal(row.querySelectorAll('button[data-action="pin"], button[data-action^="move-"]').length, 0);
  }
  const trigger = document.querySelector('#stock-actions-sh600519') as HTMLButtonElement;
  assert.equal(trigger.getAttribute('aria-label'), '打开 贵州茅台 操作菜单');
  assert.equal(trigger.textContent, '•••');
});

test('table menu trigger emits the exact stock-menu-open-request payload', () => {
  const { spy } = setupTable([card('sh600519')]);
  spy.reset();
  (document.querySelector('#stock-actions-sh600519') as HTMLButtonElement).click();
  assert.deepEqual(spy.lastEvent('stock-menu-open-request')?.detail, {
    anchorId: 'stock-actions-sh600519',
    code: 'sh600519'
  });
});

test('clicking a header button emits preferences-change with sortField', () => {
  const { spy } = setupTable([card('sh600519')]);
  spy.reset();
  const headerBtns = document.querySelectorAll('thead button');
  const priceBtn = Array.from(headerBtns).find((b) => {
    const th = b.closest('th');
    return th?.getAttribute('data-column') === 'price' || b.getAttribute('data-column') === 'price';
  }) as HTMLButtonElement | undefined;
  if (priceBtn) {
    priceBtn.click();
    const detail = spy.lastEvent('preferences-change')?.detail;
    assert.ok(detail);
    assert.equal(detail!.patch.sortField, 'price');
  }
});

test('node identity preserved across quote updates', () => {
  const { el } = setupTable([card('sh600519'), card('sz000001')]);
  const row1 = el.querySelector('tbody tr[data-key="sh600519"]');
  el.viewModel = [card('sh600519', { displayPrice: '105.00' }), card('sz000001')];
  assert.equal(el.querySelector('tbody tr[data-key="sh600519"]'), row1);
});

test('real stock row count matches a short viewModel length', () => {
  const { el } = setupTable([card('sh600519'), card('sz000001'), card('bj920001')]);
  assert.equal(el.querySelectorAll('tbody tr[data-key]').length, 3);
});

test('empty viewModel renders no real stock rows', () => {
  const { el } = setupTable([]);
  assert.equal(el.querySelectorAll('tbody tr[data-key]').length, 0);
});

test('500-stock table keeps real stock rows bounded', () => {
  const stocks = Array.from({ length: 500 }, (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`));
  const { el } = setupTable(stocks);
  el.viewport = { scrollOffset: 0, viewportExtent: 390 };
  const realRows = el.querySelectorAll('tbody tr[data-key]');
  assert.ok(realRows.length <= 27, `expected <=27 real rows, got ${realRows.length}`);
  assert.equal(el.querySelector('table')?.getAttribute('aria-rowcount'), '501');
});

test('scrolling changes the rendered key range and exposes aria-rowindex', () => {
  const stocks = Array.from({ length: 100 }, (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`));
  const { el } = setupTable(stocks);
  el.viewport = { scrollOffset: 48 * 50, viewportExtent: 390 };
  assert.ok(el.querySelector('[data-key="sh600050"]'));
  assert.equal(el.querySelector('[data-key="sh600050"]')?.getAttribute('aria-rowindex'), '52');
  assert.equal(el.querySelector('[data-key="sh600000"]'), null);
});

test('focusCode emits a virtual focus request for the stock index', () => {
  const stocks = Array.from({ length: 100 }, (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`));
  const { el } = setupTable(stocks);
  let detail: unknown;
  el.addEventListener('virtual-focus-request', (event) => {
    detail = (event as CustomEvent).detail;
  });

  assert.equal(el.focusCode('sh600050' as StockCode), true);
  assert.deepEqual(detail, { index: 50, itemExtent: 48 });
});

test('focusCode returns false for an unknown stock code', () => {
  const { el } = setupTable([card('sh600519')]);
  assert.equal(el.focusCode('sz000001' as StockCode), false);
});

test('reconnecting table does not duplicate header listeners', () => {
  const { el, spy } = setupTable([card('sh600519')]);
  el.remove();
  document.body.querySelector('div')?.append(el);
  spy.reset();
  const headerBtns = document.querySelectorAll('thead button');
  if (headerBtns.length > 0) {
    (headerBtns[0] as HTMLButtonElement).click();
    assert.equal(spy.eventCount('preferences-change'), 1);
  }
});

test('price masking shows bullets in table cell', () => {
  setupTable([card('sh600519', { displayPrice: '****' })]);
  const row = document.querySelector('tbody tr[data-key="sh600519"]') as HTMLElement;
  assert.ok(row.textContent?.includes('****'));
});

test('header includes 成交额 (amount) column', () => {
  setupTable([card('sh600519')]);
  const headers = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent);
  assert.ok(headers.includes('成交额'), `expected 成交额 in headers, got ${JSON.stringify(headers)}`);
});

test('amount column renders displayAmount text in row', () => {
  setupTable([card('sh600519', { displayAmount: '3.5亿' })]);
  const row = document.querySelector('tbody tr[data-key="sh600519"]') as HTMLElement;
  assert.ok(row.textContent?.includes('3.5亿'), 'row should contain the amount display text');
});
