// src/popup/components/stock-grid.ts
// 网格视图容器组件：按两列的视觉行虚拟化卡片。
// 使用 keyed-update 保持可见卡片节点 identity/focus 稳定。
import type { StockCode, GroupId } from '../../domain/brands.js';
import type { StockCardViewModel } from '../view-models.js';
import {
  calculateVirtualWindow,
  type VirtualViewport
} from '../virtualization/virtual-window.js';
import { updateKeyedChildren } from './keyed-update.js';
import './stock-card.js';
import type { StockCardElement } from './stock-card.js';
import { DEFAULT_UI_COLUMNS, normalizeUiColumns, type UiColumnPreferences } from '../ui-preferences.js';

const GRID_COLUMNS = 2;
const GRID_ROW_EXTENT = 126;
const GRID_GAP = 8;
const GRID_CARD_EXTENT = GRID_ROW_EXTENT - GRID_GAP;
const OVERSCAN_SCREENS = 1;

interface VisibleStock {
  readonly index: number;
  readonly viewModel: StockCardViewModel;
}

export class StockGridElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: readonly StockCardViewModel[] = [];
  private _groupId: GroupId = 'g_all' as GroupId;
  private _columns: UiColumnPreferences = DEFAULT_UI_COLUMNS;
  private _viewport: VirtualViewport = { scrollOffset: 0, viewportExtent: 390 };
  private container: HTMLElement | null = null;
  private beforeSpacer: HTMLElement | null = null;
  private afterSpacer: HTMLElement | null = null;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    const signal = this.connection.signal;
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    this.render();
  }

  disconnectedCallback(): void {
    this.connection?.abort();
    this.connection = undefined;
  }

  get viewModel(): readonly StockCardViewModel[] {
    return this._viewModel;
  }

  set viewModel(value: readonly StockCardViewModel[]) {
    this._viewModel = value;
    if (this.isConnected) this.render();
  }

  get viewport(): VirtualViewport {
    return this._viewport;
  }

  set viewport(value: VirtualViewport) {
    this._viewport = value;
    if (this.isConnected) this.render();
  }

  get groupId(): GroupId {
    return this._groupId;
  }

  set groupId(value: GroupId) {
    this._groupId = value;
    // Propagate to all child cards
    for (const child of this.container?.children ?? []) {
      if (child.localName === 'stock-card') {
        (child as StockCardElement).groupId = value;
      }
    }
  }

  get columns(): UiColumnPreferences {
    return this._columns;
  }

  set columns(value: UiColumnPreferences) {
    this._columns = normalizeUiColumns(value);
    for (const child of this.container?.children ?? []) {
      if (child.localName === 'stock-card') (child as StockCardElement).columns = this._columns;
    }
  }

  focusCode(code: StockCode): boolean {
    const stockIndex = this._viewModel.findIndex((vm) => vm.code === code);
    if (stockIndex < 0) return false;
    this.dispatchEvent(new CustomEvent('virtual-focus-request', {
      detail: {
        index: Math.floor(stockIndex / GRID_COLUMNS),
        itemExtent: GRID_ROW_EXTENT
      },
      bubbles: true,
      composed: true
    }));
    return true;
  }

  private buildSkeleton(): void {
    const container = document.createElement('div');
    container.className = 'stock-grid-container';
    container.setAttribute('data-region', 'grid-cards');
    container.setAttribute('role', 'list');
    container.style.gridTemplateColumns = `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`;
    container.style.gap = `${GRID_GAP}px`;

    const beforeSpacer = this.createSpacer('before');
    const afterSpacer = this.createSpacer('after');
    this.beforeSpacer = beforeSpacer;
    this.afterSpacer = afterSpacer;

    this.container = container;
    container.append(beforeSpacer, afterSpacer);
    this.append(container);
  }

  private createSpacer(position: 'before' | 'after'): HTMLElement {
    const spacer = document.createElement('div');
    spacer.className = `stock-grid-spacer stock-grid-spacer--${position}`;
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.gridColumn = '1 / -1';
    if (position === 'before') {
      spacer.style.marginBottom = `-${GRID_GAP}px`;
    } else {
      spacer.style.marginTop = `-${GRID_GAP}px`;
    }
    return spacer;
  }

  private render(): void {
    if (!this.container || !this.beforeSpacer || !this.afterSpacer) return;

    // 记录当前焦点所在的 data-key，渲染后恢复焦点到同一卡片。
    const focusedKey = (document.activeElement as HTMLElement | null)?.closest('[data-key]')?.getAttribute('data-key') ?? null;

    const orderedCodes = this._viewModel.map((vm) => vm.code);
    const rowCount = Math.ceil(this._viewModel.length / GRID_COLUMNS);
    const virtualWindow = calculateVirtualWindow({
      itemCount: rowCount,
      itemExtent: GRID_ROW_EXTENT,
      viewportExtent: this._viewport.viewportExtent,
      scrollOffset: this._viewport.scrollOffset,
      overscanScreens: OVERSCAN_SCREENS
    });
    const startStockIndex = virtualWindow.startIndex * GRID_COLUMNS;
    const endStockIndex = Math.min(this._viewModel.length, virtualWindow.endIndex * GRID_COLUMNS);
    const visibleStocks = this._viewModel
      .slice(startStockIndex, endStockIndex)
      .map((viewModel, offset): VisibleStock => ({
        index: startStockIndex + offset,
        viewModel
      }));

    this.updateSpacer(this.beforeSpacer, virtualWindow.beforeExtent);
    this.updateSpacer(this.afterSpacer, virtualWindow.afterExtent);

    updateKeyedChildren(
      this.container,
      visibleStocks,
      ({ viewModel }) => viewModel.code,
      ({ index, viewModel }) => this.createCard(viewModel, orderedCodes, index),
      (node, { index, viewModel }) => this.updateCard(node, viewModel, orderedCodes, index),
      this.afterSpacer
    );

    // 恢复焦点到同一 key 的卡片（keyed reorder 后节点复用）。
    if (focusedKey) {
      const cardToFocus = this.container.querySelector(`[data-key="${focusedKey}"]`);
      if (cardToFocus && document.activeElement !== cardToFocus) {
        // Only restore if the previously focused element is no longer in the DOM
        if (!document.activeElement || !document.activeElement.closest(`[data-key="${focusedKey}"]`)) {
          (cardToFocus as HTMLElement).focus?.();
        }
      }
    }
  }

  private updateSpacer(spacer: HTMLElement, extent: number): void {
    const height = `${extent}px`;
    spacer.hidden = extent === 0;
    if (spacer.style.height !== height) spacer.style.height = height;
  }

  private createCard(
    vm: StockCardViewModel,
    orderedCodes: readonly StockCode[],
    index: number
  ): HTMLElement {
    const card = document.createElement('stock-card') as StockCardElement;
    this.updateCard(card, vm, orderedCodes, index);
    return card;
  }

  private updateCard(
    node: HTMLElement,
    vm: StockCardViewModel,
    orderedCodes: readonly StockCode[],
    index: number
  ): void {
    const card = node as unknown as StockCardElement;
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-posinset', String(index + 1));
    card.setAttribute('aria-setsize', String(this._viewModel.length));
    card.style.height = `${GRID_CARD_EXTENT}px`;
    card.groupId = this._groupId;
    card.columns = this._columns;
    card.orderedCodes = orderedCodes;
    card.viewModel = vm;
  }
}
