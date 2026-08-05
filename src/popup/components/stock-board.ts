// 股票看板是行情区唯一的滚动视口，只连接当前列表/网格视图。
// 组件仅消费 ViewModel 并发出语义事件；不包含过滤、排序、RPC 或持久化逻辑。
import type { GroupId, StockCode } from '../../domain/index.js';
import type { BoardViewModel, StockCardViewModel } from '../view-models.js';
import { createRafScheduler } from '../virtualization/raf-scheduler.js';
import { emitPopupEvent } from './events.js';
import './stock-grid.js';
import './stock-table.js';
import type { StockGridElement } from './stock-grid.js';
import type { StockTableElement } from './stock-table.js';

type StockViewMode = 'list' | 'grid';
type ActiveStockView = (StockGridElement | StockTableElement) & {
  groupId: GroupId;
  viewModel: readonly StockCardViewModel[];
  viewport: { scrollOffset: number; viewportExtent: number };
  focusCode(code: StockCode): boolean;
};

interface VirtualFocusDetail {
  readonly index: number;
  readonly itemExtent: number;
}

function normalizedOffset(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export class StockBoardElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: BoardViewModel | null = null;

  private loadingEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;
  private emptyMessageEl: HTMLElement | null = null;
  private gridEl: StockGridElement | null = null;
  private tableEl: StockTableElement | null = null;

  private readonly scrollOffsets: Record<StockViewMode, number> = { list: 0, grid: 0 };
  private activeMode: StockViewMode | null = null;
  private viewportExtent = 390;
  private resizeObserver: ResizeObserver | null = null;
  private focusFrame: number | null = null;
  private pendingFocusCode: StockCode | null = null;
  private readonly scheduler = createRafScheduler(
    (callback) => window.requestAnimationFrame(callback),
    (handle) => window.cancelAnimationFrame(handle),
    () => this.flushViewport()
  );

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    this.bindEvents(this.connection.signal);
    this.observeViewport();
    if (this._viewModel) this.applyViewModel(this._viewModel);
  }

  disconnectedCallback(): void {
    this.saveActiveScrollOffset();
    this.scheduler.cancel();
    if (this.focusFrame !== null) {
      window.cancelAnimationFrame(this.focusFrame);
      this.focusFrame = null;
    }
    this.pendingFocusCode = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.connection?.abort();
    this.connection = undefined;
  }

  get viewModel(): BoardViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: BoardViewModel) {
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value);
  }

  focusCode(code: StockCode): boolean {
    const activeView = this.getActiveView();
    if (!activeView) return false;
    this.pendingFocusCode = code;
    if (activeView.focusCode(code)) return true;
    this.pendingFocusCode = null;
    return false;
  }

  private buildSkeleton(): void {
    this.setAttribute('role', 'region');
    this.setAttribute('aria-label', '股票看板');

    const loadingEl = document.createElement('div');
    loadingEl.setAttribute('data-region', 'loading');
    loadingEl.className = 'board-loading';
    loadingEl.setAttribute('hidden', '');
    loadingEl.setAttribute('aria-busy', 'true');
    loadingEl.setAttribute('aria-label', '加载中');
    for (let i = 0; i < 6; i++) {
      const row = document.createElement('div');
      row.className = 'skeleton-row';
      loadingEl.append(row);
    }
    this.loadingEl = loadingEl;

    const errorEl = document.createElement('div');
    errorEl.setAttribute('data-region', 'error');
    errorEl.className = 'board-error';
    errorEl.setAttribute('hidden', '');
    this.errorEl = errorEl;

    const emptyEl = document.createElement('div');
    emptyEl.setAttribute('data-region', 'empty');
    emptyEl.className = 'board-empty';
    emptyEl.setAttribute('hidden', '');
    const emptyMessage = document.createElement('p');
    emptyMessage.setAttribute('data-region', 'empty-message');
    this.emptyMessageEl = emptyMessage;
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.setAttribute('data-action', 'add-stock');
    addButton.textContent = '添加股票';
    emptyEl.append(emptyMessage, addButton);
    this.emptyEl = emptyEl;

    this.append(loadingEl, errorEl, emptyEl);
  }

  private bindEvents(signal: AbortSignal): void {
    this.addEventListener('scroll', () => {
      this.saveActiveScrollOffset();
      this.scheduler.schedule();
    }, { signal });

    this.addEventListener('virtual-focus-request', (event) => {
      this.routeVirtualFocus(event as CustomEvent<VirtualFocusDetail>);
    }, { signal });

    this.emptyEl?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('button[data-action="add-stock"]')) {
        emitPopupEvent(this, 'dialog-open-request', { kind: 'add-stock' });
      }
    }, { signal });
  }

  private observeViewport(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = new window.ResizeObserver(() => this.scheduler.schedule());
    this.resizeObserver.observe(this);
  }

  private applyViewModel(vm: BoardViewModel): void {
    const state = vm.loading ? 'loading' : vm.error ? 'error' : vm.empty ? 'empty' : 'data';
    this.setVisible(this.loadingEl, state === 'loading');
    this.setVisible(this.errorEl, state === 'error');
    this.setVisible(this.emptyEl, state === 'empty');

    if (state === 'error' && this.errorEl) this.errorEl.textContent = vm.error;
    if (state === 'empty' && this.emptyMessageEl) this.emptyMessageEl.textContent = vm.emptyMessage;

    if (state !== 'data') {
      this.detachActiveView();
      return;
    }

    this.activateView(vm);
  }

  private setVisible(element: HTMLElement | null, visible: boolean): void {
    if (!element) return;
    element.toggleAttribute('hidden', !visible);
  }

  private activateView(vm: BoardViewModel): void {
    const mode = vm.viewMode;
    if (this.activeMode !== mode) {
      this.detachActiveView();
      const view = this.getOrCreateView(mode);
      this.append(view);
      this.activeMode = mode;
      this.scrollTop = normalizedOffset(this.scrollOffsets[mode]);
    }

    const activeView = this.getActiveView();
    if (!activeView) return;
    activeView.groupId = vm.groupId;
    activeView.viewModel = vm.stocks;
    this.flushViewport();
  }

  private getOrCreateView(mode: StockViewMode): ActiveStockView {
    if (mode === 'list') {
      this.tableEl ??= document.createElement('stock-table') as StockTableElement;
      return this.tableEl as ActiveStockView;
    }
    this.gridEl ??= document.createElement('stock-grid') as StockGridElement;
    return this.gridEl as ActiveStockView;
  }

  private getActiveView(): ActiveStockView | null {
    if (this.activeMode === 'list') return this.tableEl as ActiveStockView | null;
    if (this.activeMode === 'grid') return this.gridEl as ActiveStockView | null;
    return null;
  }

  private detachActiveView(): void {
    const activeView = this.getActiveView();
    if (!activeView) return;
    this.saveActiveScrollOffset();
    activeView.remove();
    this.activeMode = null;
  }

  private saveActiveScrollOffset(): void {
    if (this.activeMode) {
      this.scrollOffsets[this.activeMode] = normalizedOffset(this.scrollTop);
    }
  }

  private flushViewport(): void {
    const activeView = this.getActiveView();
    if (!activeView?.isConnected) return;
    this.saveActiveScrollOffset();
    this.viewportExtent = this.clientHeight || 390;
    activeView.viewport = {
      scrollOffset: Math.max(0, normalizedOffset(this.scrollTop) - 28),
      viewportExtent: this.viewportExtent
    };
  }

  private routeVirtualFocus(event: CustomEvent<VirtualFocusDetail>): void {
    const activeView = this.getActiveView();
    if (!activeView || event.target !== activeView) return;
    const { index, itemExtent } = event.detail;
    if (!Number.isFinite(index) || index < 0 || !Number.isFinite(itemExtent) || itemExtent <= 0) {
      this.pendingFocusCode = null;
      return;
    }

    event.stopPropagation();
    this.scrollTop = normalizedOffset(index * itemExtent);
    this.saveActiveScrollOffset();
    this.scheduler.cancel();
    this.flushViewport();

    const requestedCode = this.pendingFocusCode ?? this.codeAtVirtualIndex(index);
    this.pendingFocusCode = null;
    if (!requestedCode) return;
    if (this.focusFrame !== null) window.cancelAnimationFrame(this.focusFrame);
    this.focusFrame = window.requestAnimationFrame(() => {
      this.focusFrame = null;
      if (!this.isConnected) return;
      const keyed = this.getActiveView()?.querySelector<HTMLElement>(`[data-key="${requestedCode}"]`);
      if (!keyed) return;
      const control = keyed.matches('[tabindex]')
        ? keyed
        : keyed.querySelector<HTMLElement>('button, [tabindex]');
      control?.focus();
    });
  }

  private codeAtVirtualIndex(index: number): StockCode | null {
    if (!this._viewModel || !this.activeMode) return null;
    const stockIndex = this.activeMode === 'grid' ? index * 2 : index;
    return this._viewModel.stocks[stockIndex]?.code ?? null;
  }
}
