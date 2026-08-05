// src/popup/components/stock-board.ts
// Task 16 Step 3 — 小型视图切换器。
// 拥有稳定的 empty/loading/error 容器 + 一个 stock-grid + 一个 stock-table。
// 根据 viewMode 设置 hidden；board region 有 aria-label，不对整个股票列表使用 aria-live。
// 不含过滤、排序、RPC 或持久化逻辑。
// 架构约束：仅 import domain + view-models + events；per-connection AbortController。
import type { BoardViewModel } from '../view-models.js';
import './stock-grid.js';
import './stock-table.js';
import type { StockGridElement } from './stock-grid.js';
import type { StockTableElement } from './stock-table.js';
import { TABLE_HEADER_EXTENT } from './stock-table.js';
import { createRafScheduler } from '../virtualization/raf-scheduler.js';
import type { RafScheduler } from '../virtualization/raf-scheduler.js';

/** 看板可视高度兜底（元素未布局时 clientHeight 为 0）。 */
const FALLBACK_VIEWPORT_EXTENT = 390;

type ViewMode = 'list' | 'grid';

/** 支持虚拟化的子视图共同接口。 */
interface VirtualView extends HTMLElement {
  viewport: { scrollOffset: number; viewportExtent: number };
}

export class StockBoardElement extends HTMLElement {
  private skeletonBuilt = false;
  private _viewModel: BoardViewModel | null = null;

  private loadingEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;
  /** 惰性创建：只有被激活过的视图才会存在。 */
  private gridEl: StockGridElement | null = null;
  private tableEl: StockTableElement | null = null;

  private connection: AbortController | undefined;
  /** 当前挂载的视图模式；null 表示 loading/error/empty 态（无数据视图）。 */
  private activeMode: ViewMode | null = null;
  /** list / grid 各自独立的滚动位置，切换视图时互不干扰。 */
  private readonly scrollOffsets: Record<ViewMode, number> = { list: 0, grid: 0 };
  private scheduler: RafScheduler | null = null;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    const signal = this.connection.signal;

    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }

    // 看板是唯一的滚动拥有者——滚动事件频率高于帧率，合并到每帧一次。
    this.scheduler = createRafScheduler(
      (cb) => requestAnimationFrame(cb),
      (id) => cancelAnimationFrame(id),
      () => this.flushViewport()
    );
    this.addEventListener('scroll', () => this.scheduler?.schedule(), { signal, passive: true });
    this.addEventListener('virtual-focus-request', ((event: Event) => {
      this.handleVirtualFocus(event as CustomEvent<{ index: number; itemExtent: number }>);
    }) as EventListener, { signal });

    if (this._viewModel) this.applyViewModel(this._viewModel);
  }

  disconnectedCallback(): void {
    this.connection?.abort();
    this.connection = undefined;
    this.scheduler?.cancel();
    this.scheduler = null;
  }

  get viewModel(): BoardViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: BoardViewModel) {
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value);
  }

  private buildSkeleton(): void {
    this.setAttribute('role', 'region');
    this.setAttribute('aria-label', '股票看板');

    // Loading container — 骨架屏（5 个灰色占位条，无假数字）
    const loadingEl = document.createElement('div');
    loadingEl.setAttribute('data-region', 'loading');
    loadingEl.className = 'board-loading';
    loadingEl.setAttribute('hidden', '');
    loadingEl.setAttribute('aria-busy', 'true');
    loadingEl.setAttribute('aria-label', '加载中');
    for (let i = 0; i < 5; i++) {
      const row = document.createElement('div');
      row.className = 'skeleton-row';
      loadingEl.append(row);
    }
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

    // list / grid 视图不在此创建——只有被激活时才惰性挂载（见 mountView）。
    this.append(loadingEl, errorEl, emptyEl);
  }

  /**
   * 挂载目标视图并卸载另一个。
   *
   * 此前两个视图始终挂载且**都**会被赋值 viewModel——隐藏的那个也要完整
   * 渲染一遍，每次行情刷新的 DOM 工作量直接翻倍。
   */
  private mountView(mode: ViewMode | null): void {
    if (this.activeMode === mode) return;

    // 记住离开视图的滚动位置，回来时恢复。
    if (this.activeMode !== null) {
      this.scrollOffsets[this.activeMode] = this.scrollTop;
    }

    if (this.activeMode === 'list') this.tableEl?.remove();
    if (this.activeMode === 'grid') this.gridEl?.remove();

    this.activeMode = mode;
    if (mode === null) return;

    if (mode === 'list') {
      this.tableEl ??= document.createElement('stock-table') as StockTableElement;
      this.append(this.tableEl);
    } else {
      this.gridEl ??= document.createElement('stock-grid') as StockGridElement;
      this.append(this.gridEl);
    }
    this.scrollTop = this.scrollOffsets[mode];
  }

  /** 当前挂载的视图（loading/error/empty 时为 null）。 */
  private activeView(): VirtualView | null {
    if (this.activeMode === 'list') return this.tableEl as unknown as VirtualView | null;
    if (this.activeMode === 'grid') return this.gridEl as unknown as VirtualView | null;
    return null;
  }

  /** 把当前视口推给激活视图。表格要扣掉粘性表头占用的高度。 */
  private flushViewport(): void {
    const view = this.activeView();
    if (!view) return;
    const headerOffset = this.activeMode === 'list' ? TABLE_HEADER_EXTENT : 0;
    view.viewport = {
      scrollOffset: Math.max(0, this.scrollTop - headerOffset),
      viewportExtent: this.clientHeight || FALLBACK_VIEWPORT_EXTENT
    };
  }

  /**
   * 处理子视图的「把索引 N 滚进视口」请求。
   * 目标行可能尚未挂载，因此必须先滚动 + 同步刷新视口，下一帧再聚焦。
   */
  private handleVirtualFocus(event: CustomEvent<{ index: number; itemExtent: number }>): void {
    const { index, itemExtent } = event.detail;
    this.scrollTop = index * itemExtent;
    this.flushViewport();
    requestAnimationFrame(() => {
      const target = this.querySelector<HTMLElement>('[data-key]:not([data-spacer])');
      target?.focus?.();
    });
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

    // loading / error / empty 与数据视图互斥——此时不挂载任何数据视图。
    const showViews = !vm.loading && !vm.error && !vm.empty;
    this.mountView(showViews ? vm.viewMode : null);

    // 只给**激活**视图喂数据；未挂载的那个不做任何渲染工作。
    const view = this.activeView();
    if (!view) return;
    if (this.activeMode === 'list' && this.tableEl) {
      this.tableEl.groupId = vm.groupId;
      this.tableEl.viewModel = vm.stocks;
    } else if (this.activeMode === 'grid' && this.gridEl) {
      this.gridEl.groupId = vm.groupId;
      this.gridEl.viewModel = vm.stocks;
    }
    this.flushViewport();
  }
}
