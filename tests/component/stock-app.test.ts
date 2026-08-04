// tests/component/stock-app.test.ts
// Task 14 Step 1 — stock-app 根组件骨架：Light DOM 结构、viewModel 驱动文本更新。
// 组件绝不 import Store/Commands/Infrastructure；仅消费 AppViewModel 纯数据。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { AppViewModel } from '../../src/popup/view-models.js';
import type { GroupId } from '../../src/domain/index.js';

/** 构造最小 AppViewModel 用于断言渲染（字段均可控）。 */
function mkViewModel(overrides: Partial<AppViewModel> = {}): AppViewModel {
  return {
    currentGroupId: 'g_all' as GroupId,
    searchKeyword: '',
    header: { groupName: '全部', stockCount: 0 },
    groupTabs: [],
    stocks: [],
    toolbar: {
      viewMode: 'list',
      sortField: 'manual',
      sortDirection: 'asc',
      priceHidden: false,
      totalCount: 0,
      hasStocks: false
    },
    batchToolbar: { visible: false, selectedCount: 0, selectedCodes: [] },
    quoteStatus: { status: 'idle', message: '' },
    liveRegion: { message: '', kind: 'none' },
    ...overrides
  };
}

test('connectedCallback renders the header / board / footer skeleton once', () => {
  resetDom();
  definePopupElements();
  const el = document.createElement('stock-app');
  document.body.append(el);

  // 骨架：header + board + footer 三个稳定 region 容器（Light DOM）。
  assert.ok(el.querySelector('[data-region="header"]'));
  assert.ok(el.querySelector('[data-region="board"]'));
  assert.ok(el.querySelector('[data-region="footer"]'));
});

test('setting viewModel updates the header text from the header view model', () => {
  resetDom();
  definePopupElements();
  const el = document.createElement('stock-app') as HTMLElement & { viewModel: AppViewModel };
  document.body.append(el);

  el.viewModel = mkViewModel({ header: { groupName: '科技股', stockCount: 5 } });
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
  el.viewModel = mkViewModel({ header: { groupName: '第一', stockCount: 1 } });
  el.viewModel = mkViewModel({ header: { groupName: '第二', stockCount: 2 } });

  assert.equal(el.querySelectorAll('[data-region="header"]').length, 1);
  assert.equal(el.querySelectorAll('[data-region="board"]').length, 1);
  assert.equal(el.querySelectorAll('[data-region="footer"]').length, 1);
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
