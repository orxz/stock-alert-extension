// tests/component/stock-app.test.ts
// Task 14+18 — stock-app 根组件骨架：Light DOM 结构、viewModel 驱动子组件渲染。
// 组件绝不 import Store/Commands/Infrastructure；仅消费 AppViewModel 纯数据。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { AppViewModel } from '../../src/popup/view-models.js';
import { closedDialog } from '../../src/popup/view-models.js';
import type { GroupId } from '../../src/domain/index.js';
import type { StockCode } from '../../src/domain/index.js';
import { DEFAULT_UI_COLUMNS } from '../../src/popup/ui-preferences.js';

/** 构造最小 AppViewModel 用于断言渲染（字段均可控）。 */
function mkViewModel(overrides: Partial<AppViewModel> = {}): AppViewModel {
  return {
    currentGroupId: 'g_all' as GroupId,
    searchKeyword: '',
    header: { groupName: '全部', stockCount: 0, selectionMode: false, priceHidden: false, canAddStock: true, theme: 'dark' },
    groupTabs: [],
    board: {
      viewMode: 'list',
      groupId: 'g_all' as GroupId,
      stocks: [],
      loading: false,
      error: null,
      empty: true,
      emptyMessage: '暂无股票，点击添加',
      columns: DEFAULT_UI_COLUMNS
    },
    columnPanel: { columns: DEFAULT_UI_COLUMNS },
    toolbar: {
      viewMode: 'list',
      sortField: 'manual',
      sortDirection: 'asc',
      priceHidden: false,
      searchKeyword: '',
      totalCount: 0,
      hasStocks: false
    },
    batchToolbar: { visible: false, selectedCount: 0, selectedCodes: [], groupId: 'g_all' as GroupId },
    quoteStatus: {
      status: 'idle',
      message: '',
      freshCount: 0,
      cachedCount: 0,
      missingCount: 0,
      lastRefreshTime: '',
      deferredUntil: ''
    },
    liveRegion: { message: '', kind: 'none' },
    dialog: closedDialog(),
    ...overrides
  };
}

test('connectedCallback renders the header / group-tabs / board skeleton', () => {
  resetDom();
  definePopupElements();
  const el = document.createElement('stock-app');
  document.body.append(el);

  // 骨架：header + group-tabs + board + toolbar 等稳定 region 容器（Light DOM）。
  assert.ok(el.querySelector('[data-region="header"]'));
  assert.ok(el.querySelector('[data-region="group-tabs"]'));
  assert.ok(el.querySelector('[data-region="board"]'));
  assert.ok(el.querySelector('[data-region="toolbar"]'));
});

test('setting viewModel distributes to header sub-component', () => {
  resetDom();
  definePopupElements();
  const el = document.createElement('stock-app') as HTMLElement & { viewModel: AppViewModel };
  document.body.append(el);

  el.viewModel = mkViewModel({ header: { groupName: '科技股', stockCount: 5, selectionMode: false, priceHidden: false, canAddStock: true, theme: 'dark' } });
  const header = el.querySelector('[data-region="header"]');
  const text = header?.textContent ?? '';
  assert.ok(text.includes('科技股'), 'header 应显示分组名');
  assert.ok(text.includes('5'), 'header 应显示股票数');
});

test('reassigning viewModel keeps the skeleton stable (no duplicate regions)', () => {
  resetDom();
  definePopupElements();
  const el = document.createElement('stock-app') as HTMLElement & { viewModel: AppViewModel };
  document.body.append(el);
  el.viewModel = mkViewModel({ header: { groupName: '第一', stockCount: 1, selectionMode: false, priceHidden: false, canAddStock: true, theme: 'dark' } });
  el.viewModel = mkViewModel({ header: { groupName: '第二', stockCount: 2, selectionMode: false, priceHidden: false, canAddStock: true, theme: 'dark' } });

  assert.equal(el.querySelectorAll('[data-region="header"]').length, 1);
  assert.equal(el.querySelectorAll('[data-region="board"]').length, 1);
  assert.ok((el.querySelector('[data-region="header"]')?.textContent ?? '').includes('第二'));
});

test('definePopupElements is idempotent (guard against duplicate registration)', () => {
  resetDom();
  definePopupElements();
  definePopupElements(); // 不应抛出（customElements.get 守卫）
  const el = document.createElement('stock-app');
  document.body.append(el);
  assert.ok(el.querySelector('[data-region="header"]'));
});

test('stock-app routes focusCode to the active virtual stock view', async () => {
  resetDom();
  definePopupElements();
  const stocks = Array.from({ length: 100 }, (_, i) => ({
    code: `sh${String(600000 + i).padStart(6, '0')}` as StockCode,
    name: `股票${i}`,
    price: 100,
    change: 1,
    changePercent: 1,
    status: 'fresh' as const,
    pinned: false,
    staleLabel: '',
    displayPrice: '100.00',
    displayChange: '+1.00',
    displayAmount: '1.2亿'
  }));
  const el = document.createElement('stock-app') as HTMLElement & {
    viewModel: AppViewModel;
    focusCode(code: StockCode): boolean;
  };
  document.body.append(el);
  el.viewModel = mkViewModel({
    board: {
      viewMode: 'list',
      groupId: 'g_all' as GroupId,
      stocks,
      loading: false,
      error: null,
      empty: false,
      emptyMessage: '暂无股票',
      columns: DEFAULT_UI_COLUMNS
    }
  });

  assert.equal(el.focusCode('sh600050' as StockCode), true);
  const board = el.querySelector('stock-board') as HTMLElement;
  assert.equal(board.scrollTop, 48 * 50);
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  assert.equal(document.activeElement?.closest('[data-key]')?.getAttribute('data-key'), 'sh600050');
});
