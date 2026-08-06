// src/popup/components/stock-app.ts
// Task 18 — 根组件：组合全部子组件并分发 AppViewModel。
// 子组件通过 CustomEvent（bubbles+composed）冒泡语义事件到本元素，
// AppShell 在此元素上监听并路由到 Store dispatch / CommandController。
// 架构约束：仅 import domain types + view-models + 子组件；无 RPC/Store 依赖。
import type { AppViewModel } from '../view-models.js';
import './stock-header.js';
import './group-tabs.js';
import './stock-toolbar.js';
import './stock-board.js';
import './batch-toolbar.js';
import './quote-status.js';
import type { StockHeaderElement } from './stock-header.js';
import type { GroupTabsElement } from './group-tabs.js';
import type { StockToolbarElement } from './stock-toolbar.js';
import type { StockBoardElement } from './stock-board.js';
import type { BatchToolbarElement } from './batch-toolbar.js';
import type { QuoteStatusElement } from './quote-status.js';

// 类型断言 helper：document.createElement 返回 HTMLElement，需断言为具体类型。
function create<T extends HTMLElement>(tag: string): T {
  return document.createElement(tag) as T;
}

export class StockAppElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: AppViewModel | null = null;

  // 子组件引用
  private headerEl: StockHeaderElement | null = null;
  private tabsEl: GroupTabsElement | null = null;
  private toolbarEl: StockToolbarElement | null = null;
  private boardEl: StockBoardElement | null = null;
  private batchEl: BatchToolbarElement | null = null;
  private quoteStatusEl: QuoteStatusElement | null = null;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    if (this._viewModel) this.applyViewModel(this._viewModel);
  }

  disconnectedCallback(): void {
    this.connection?.abort();
    this.connection = undefined;
  }

  get viewModel(): AppViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: AppViewModel) {
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value);
  }

  private buildSkeleton(): void {
    this.className = 'stock-app-root';

    // 使用 document.createElement 而非 new Element()——自定义元素必须通过 createElement
    // 创建（或由解析器升级），直接 new 会在未注册时抛 Illegal constructor。

    // 顶部头部（主题/价格/添加股票按钮）
    const header = create<StockHeaderElement>('stock-header');
    header.setAttribute('data-region', 'header');
    this.headerEl = header;
    this.append(header);

    // 分组导航标签
    const tabs = create<GroupTabsElement>('group-tabs');
    tabs.setAttribute('data-region', 'group-tabs');
    tabs.id = 'group-tabs';
    this.tabsEl = tabs;
    this.append(tabs);

    // 工具栏（搜索/排序/视图切换/列设置）
    const toolbar = create<StockToolbarElement>('stock-toolbar');
    toolbar.setAttribute('data-region', 'toolbar');
    this.toolbarEl = toolbar;
    this.append(toolbar);

    // 批量操作工具栏（选中态时可见）
    const batch = create<BatchToolbarElement>('batch-toolbar');
    batch.setAttribute('data-region', 'batch-toolbar');
    batch.id = 'batch-toolbar';
    batch.setAttribute('hidden', '');
    this.batchEl = batch;
    this.append(batch);

    // 看板（grid/table + loading/error/empty）
    const board = create<StockBoardElement>('stock-board');
    board.setAttribute('data-region', 'board');
    board.id = 'stock-board';
    this.boardEl = board;
    this.append(board);

    // 行情刷新状态
    const quoteStatus = create<QuoteStatusElement>('quote-status');
    quoteStatus.setAttribute('data-region', 'quote-status');
    quoteStatus.id = 'quote-status-summary';
    this.quoteStatusEl = quoteStatus;
    this.append(quoteStatus);
  }

  private applyViewModel(vm: AppViewModel): void {
    if (this.headerEl) this.headerEl.viewModel = vm.header;
    if (this.tabsEl) {
      this.tabsEl.viewModel = vm.groupTabs;
      this.tabsEl.selectionMode = vm.batchToolbar.visible;
    }
    if (this.toolbarEl) this.toolbarEl.viewModel = vm.toolbar;
    if (this.boardEl) {
      this.boardEl.viewModel = vm.board;
      this.boardEl.selectedCodes = vm.batchToolbar.selectedCodes;
      this.boardEl.selectionMode = vm.batchToolbar.visible;
    }
    if (this.batchEl) this.batchEl.viewModel = vm.batchToolbar;
    if (this.quoteStatusEl) this.quoteStatusEl.viewModel = vm.quoteStatus;
  }
}
