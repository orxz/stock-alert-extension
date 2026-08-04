// src/popup/components/stock-toolbar.ts
// Task 15 Step 5 — 工具栏组件（排序 / 搜索 / 视图切换 / 列设置）。
// 排序 select 一次发出含 sortField+sortDirection 的 preferences-change patch；
// 搜索 input 发出 search-keyword-change（绝不回写 BoardConfig）；
// grid/list 切换发出 view-mode-change 最终值；列设置发出 column-panel-open-request。
// 架构约束：仅 import domain + view-models + events；per-connection AbortController。
import type { SortField, SortDirection } from '../../domain/index.js';
import type { ToolbarViewModel } from '../view-models.js';
import type { ViewMode } from './events.js';
import { emitPopupEvent } from './events.js';

interface SortOption {
  readonly value: string;
  readonly label: string;
  readonly field: SortField;
  readonly direction: SortDirection;
}

const SORT_OPTIONS: readonly SortOption[] = [
  { value: 'manual:asc', label: '手动排序', field: 'manual', direction: 'asc' },
  { value: 'addedAt:desc', label: '添加时间（新→旧）', field: 'addedAt', direction: 'desc' },
  { value: 'addedAt:asc', label: '添加时间（旧→新）', field: 'addedAt', direction: 'asc' },
  { value: 'name:asc', label: '名称（A→Z）', field: 'name', direction: 'asc' },
  { value: 'name:desc', label: '名称（Z→A）', field: 'name', direction: 'desc' },
  { value: 'price:desc', label: '价格（高→低）', field: 'price', direction: 'desc' },
  { value: 'price:asc', label: '价格（低→高）', field: 'price', direction: 'asc' },
  { value: 'change:desc', label: '涨跌额（高→低）', field: 'change', direction: 'desc' },
  { value: 'change:asc', label: '涨跌额（低→高）', field: 'change', direction: 'asc' },
  { value: 'changePercent:desc', label: '涨跌幅（高→低）', field: 'changePercent', direction: 'desc' },
  { value: 'changePercent:asc', label: '涨跌幅（低→高）', field: 'changePercent', direction: 'asc' },
  { value: 'amount:desc', label: '成交额（高→低）', field: 'amount', direction: 'desc' },
  { value: 'amount:asc', label: '成交额（低→高）', field: 'amount', direction: 'asc' }
];

export class StockToolbarElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: ToolbarViewModel | null = null;

  private sortSelect: HTMLSelectElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private viewListBtn: HTMLButtonElement | null = null;
  private viewGridBtn: HTMLButtonElement | null = null;
  private columnBtn: HTMLButtonElement | null = null;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    const signal = this.connection.signal;
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    this.bindEvents(signal);
    if (this._viewModel) this.applyViewModel(this._viewModel);
  }

  disconnectedCallback(): void {
    this.connection?.abort();
    this.connection = undefined;
  }

  get viewModel(): ToolbarViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: ToolbarViewModel) {
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value);
  }

  private buildSkeleton(): void {
    const toolbar = document.createElement('div');
    toolbar.className = 'stock-toolbar';

    // 搜索输入
    const searchWrap = document.createElement('div');
    searchWrap.className = 'toolbar-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.setAttribute('data-action', 'search');
    searchInput.setAttribute('aria-label', '搜索股票');
    searchInput.setAttribute('placeholder', '搜索代码或名称');
    searchInput.className = 'toolbar-search-input';
    this.searchInput = searchInput;
    searchWrap.append(searchInput);

    // 排序选择
    const sortSelect = document.createElement('select');
    sortSelect.setAttribute('data-action', 'sort');
    sortSelect.setAttribute('aria-label', '排序方式');
    sortSelect.className = 'toolbar-sort';
    for (const opt of SORT_OPTIONS) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      sortSelect.append(option);
    }
    this.sortSelect = sortSelect;

    // 视图切换按钮组
    const viewGroup = document.createElement('div');
    viewGroup.className = 'toolbar-view-group';
    viewGroup.setAttribute('role', 'group');
    viewGroup.setAttribute('aria-label', '视图模式');

    const viewListBtn = document.createElement('button');
    viewListBtn.type = 'button';
    viewListBtn.className = 'toolbar-view-btn';
    viewListBtn.setAttribute('data-action', 'view-list');
    viewListBtn.setAttribute('aria-pressed', 'false');
    viewListBtn.textContent = '列表视图';
    this.viewListBtn = viewListBtn;

    const viewGridBtn = document.createElement('button');
    viewGridBtn.type = 'button';
    viewGridBtn.className = 'toolbar-view-btn';
    viewGridBtn.setAttribute('data-action', 'view-grid');
    viewGridBtn.setAttribute('aria-pressed', 'false');
    viewGridBtn.textContent = '网格视图';
    this.viewGridBtn = viewGridBtn;

    viewGroup.append(viewListBtn, viewGridBtn);

    // 列设置按钮
    const columnBtn = document.createElement('button');
    columnBtn.type = 'button';
    columnBtn.className = 'toolbar-btn';
    columnBtn.setAttribute('data-action', 'column-settings');
    columnBtn.setAttribute('aria-label', '列设置');
    columnBtn.textContent = '列设置';
    this.columnBtn = columnBtn;

    toolbar.append(searchWrap, sortSelect, viewGroup, columnBtn);
    this.append(toolbar);
  }

  private bindEvents(signal: AbortSignal): void {
    // 排序选择 → 一次发出 sortField + sortDirection patch。
    this.sortSelect?.addEventListener('change', () => {
      const value = this.sortSelect?.value ?? '';
      const opt = SORT_OPTIONS.find((o) => o.value === value);
      if (opt) {
        emitPopupEvent(this, 'preferences-change', {
          patch: { sortField: opt.field, sortDirection: opt.direction }
        });
      }
    }, { signal });

    // 搜索输入 → 发出最终 keyword（绝不回写 BoardConfig）。
    this.searchInput?.addEventListener('input', () => {
      emitPopupEvent(this, 'search-keyword-change', {
        keyword: this.searchInput?.value ?? ''
      });
    }, { signal });

    // 视图切换 → 发出最终 viewMode。
    this.viewListBtn?.addEventListener('click', () => {
      emitPopupEvent(this, 'view-mode-change', { viewMode: 'list' as ViewMode });
    }, { signal });

    this.viewGridBtn?.addEventListener('click', () => {
      emitPopupEvent(this, 'view-mode-change', { viewMode: 'grid' as ViewMode });
    }, { signal });

    // 列设置 → 打开列设置面板。
    this.columnBtn?.addEventListener('click', () => {
      emitPopupEvent(this, 'column-panel-open-request', {});
    }, { signal });
  }

  private applyViewModel(vm: ToolbarViewModel): void {
    // 排序 select 当前值。
    if (this.sortSelect) {
      const target = `${vm.sortField}:${vm.sortDirection}`;
      // 如果精确匹配不存在（如 manual:desc），回退到字段的第一个选项。
      const hasExact = SORT_OPTIONS.some((o) => o.value === target);
      this.sortSelect.value = hasExact ? target : `${vm.sortField}:asc`;
    }

    // 搜索 input：仅当 DOM 值与 viewModel 不一致时更新，避免打断用户输入。
    if (this.searchInput && this.searchInput.value !== vm.searchKeyword) {
      this.searchInput.value = vm.searchKeyword;
    }

    // 视图模式 aria-pressed。
    if (this.viewListBtn) {
      this.viewListBtn.setAttribute('aria-pressed', String(vm.viewMode === 'list'));
      this.viewListBtn.classList.toggle('is-active', vm.viewMode === 'list');
    }
    if (this.viewGridBtn) {
      this.viewGridBtn.setAttribute('aria-pressed', String(vm.viewMode === 'grid'));
      this.viewGridBtn.classList.toggle('is-active', vm.viewMode === 'grid');
    }
  }
}
