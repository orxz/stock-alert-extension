// src/popup/components/stock-board.ts
// Task 16 Step 3 — 小型视图切换器。
// 拥有稳定的 empty/loading/error 容器 + 一个 stock-grid + 一个 stock-table。
// 根据 viewMode 设置 hidden；board region 有 aria-label，不对整个股票列表使用 aria-live。
// 不含过滤、排序、RPC 或持久化逻辑。
// 架构约束：仅 import domain + view-models + events；per-connection AbortController。
import type { BoardViewModel } from '../view-models.js';
import './stock-grid.js';
import './stock-table.js';
import { StockGridElement } from './stock-grid.js';
import { StockTableElement } from './stock-table.js';

export class StockBoardElement extends HTMLElement {
  private skeletonBuilt = false;
  private _viewModel: BoardViewModel | null = null;

  private loadingEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;
  private gridEl: StockGridElement | null = null;
  private tableEl: StockTableElement | null = null;

  connectedCallback(): void {
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    if (this._viewModel) this.applyViewModel(this._viewModel);
  }

  disconnectedCallback(): void {
    // Board has no event listeners of its own; child components manage their own lifecycle.
  }

  get viewModel(): BoardViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: BoardViewModel) {
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value);
  }

  private buildSkeleton(): void {
    this.setAttribute('aria-label', '股票看板');

    // Loading container
    const loadingEl = document.createElement('div');
    loadingEl.setAttribute('data-region', 'loading');
    loadingEl.className = 'board-loading';
    loadingEl.setAttribute('hidden', '');
    loadingEl.textContent = '加载中…';
    this.loadingEl = loadingEl;

    // Error container
    const errorEl = document.createElement('div');
    errorEl.setAttribute('data-region', 'error');
    errorEl.className = 'board-error';
    errorEl.setAttribute('hidden', '');
    this.errorEl = errorEl;

    // Empty container
    const emptyEl = document.createElement('div');
    emptyEl.setAttribute('data-region', 'empty');
    emptyEl.className = 'board-empty';
    emptyEl.setAttribute('hidden', '');
    this.emptyEl = emptyEl;

    // Grid view
    const gridEl = new StockGridElement();
    gridEl.setAttribute('hidden', '');
    this.gridEl = gridEl;

    // Table view
    const tableEl = new StockTableElement();
    tableEl.setAttribute('hidden', '');
    this.tableEl = tableEl;

    this.append(loadingEl, errorEl, emptyEl, gridEl as unknown as HTMLElement, tableEl as unknown as HTMLElement);
  }

  private applyViewModel(vm: BoardViewModel): void {
    // Loading state
    if (this.loadingEl) {
      if (vm.loading) {
        this.loadingEl.removeAttribute('hidden');
      } else {
        this.loadingEl.setAttribute('hidden', '');
      }
    }

    // Error state
    if (this.errorEl) {
      if (vm.error) {
        this.errorEl.removeAttribute('hidden');
        this.errorEl.textContent = vm.error;
      } else {
        this.errorEl.setAttribute('hidden', '');
      }
    }

    // Empty state
    if (this.emptyEl) {
      if (vm.empty) {
        this.emptyEl.removeAttribute('hidden');
        this.emptyEl.textContent = vm.emptyMessage;
      } else {
        this.emptyEl.setAttribute('hidden', '');
      }
    }

    // Grid/table visibility: hide both when loading/error/empty
    const showViews = !vm.loading && !vm.error && !vm.empty;

    if (this.gridEl) {
      this.gridEl.groupId = vm.groupId;
      this.gridEl.viewModel = vm.stocks;
      if (showViews && vm.viewMode === 'grid') {
        this.gridEl.removeAttribute('hidden');
      } else {
        this.gridEl.setAttribute('hidden', '');
      }
    }

    if (this.tableEl) {
      this.tableEl.groupId = vm.groupId;
      this.tableEl.viewModel = vm.stocks;
      if (showViews && vm.viewMode === 'list') {
        this.tableEl.removeAttribute('hidden');
      } else {
        this.tableEl.setAttribute('hidden', '');
      }
    }
  }
}
