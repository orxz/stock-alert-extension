// src/popup/components/stock-grid.ts
// Task 16 Step 3-5 — 网格视图容器组件。
// 使用 keyed-update 保持卡片节点 identity/focus/scroll 稳定。
// 事件委托：在 grid 容器上监听 stock-card 的 pin/order 事件并转发。
// 架构约束：仅 import domain + view-models + events + keyed-update；per-connection AbortController。
import type { StockCode, GroupId } from '../../domain/brands.js';
import type { StockCardViewModel } from '../view-models.js';
import { updateKeyedChildren } from './keyed-update.js';
import { emitPopupEvent } from './events.js';
import { calculateVirtualWindow } from '../virtualization/virtual-window.js';
import type { VirtualViewport } from '../virtualization/virtual-window.js';
import './stock-card.js';
import type { StockCardElement } from './stock-card.js';

/** 网格列数——与 board.css 的 grid-template-columns 一致。 */
const GRID_COLUMNS = 2;
/** 单行高度（px）：卡片高度 + 行间距。 */
export const GRID_ROW_EXTENT = 126;
/** 视口上下各多渲染一屏。 */
const OVERSCAN_SCREENS = 1;

/** 创建撑高度用的 spacer（跨满整行，不参与 keyed diff）。 */
function createSpacer(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-spacer', '');
  el.setAttribute('aria-hidden', 'true');
  el.style.gridColumn = '1 / -1';
  el.style.height = '0px';
  return el;
}

export class StockGridElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: readonly StockCardViewModel[] = [];
  private _groupId: GroupId = 'g_all' as GroupId;
  private container: HTMLElement | null = null;
  private topSpacer: HTMLElement | null = null;
  private bottomSpacer: HTMLElement | null = null;
  /** 视口由 stock-board（唯一滚动拥有者）推送。 */
  private _viewport: VirtualViewport = { scrollOffset: 0, viewportExtent: 390 };

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

  get viewport(): VirtualViewport {
    return this._viewport;
  }

  set viewport(value: VirtualViewport) {
    this._viewport = value;
    if (this.isConnected) this.render();
  }

  /**
   * 请求把 `code` 滚入视口。
   * 网格按「行」滚动，因此上报的是行索引与行高，不是卡片索引。
   */
  focusCode(code: StockCode): boolean {
    const index = this._viewModel.findIndex((vm) => vm.code === code);
    if (index < 0) return false;
    emitPopupEvent(this, 'virtual-focus-request', {
      index: Math.floor(index / GRID_COLUMNS),
      itemExtent: GRID_ROW_EXTENT,
      code
    });
    return true;
  }

  private buildSkeleton(): void {
    const container = document.createElement('div');
    container.className = 'stock-grid-container';
    container.setAttribute('data-region', 'grid-cards');
    container.setAttribute('role', 'list');
    this.topSpacer = createSpacer();
    this.bottomSpacer = createSpacer();
    container.append(this.topSpacer, this.bottomSpacer);
    this.container = container;
    this.append(container);
  }

  private render(): void {
    if (!this.container) return;

    const total = this._viewModel.length;
    // 虚拟单位是「行」而不是「卡片」——两列布局下按卡片算窗口会算出
    // 两倍高度的 spacer，滚动条长度直接翻倍。
    const rowCount = Math.ceil(total / GRID_COLUMNS);
    const window = calculateVirtualWindow({
      itemCount: rowCount,
      itemExtent: GRID_ROW_EXTENT,
      viewportExtent: this._viewport.viewportExtent,
      scrollOffset: this._viewport.scrollOffset,
      overscanScreens: OVERSCAN_SCREENS
    });

    if (this.topSpacer) this.topSpacer.style.height = `${window.beforeExtent}px`;
    if (this.bottomSpacer) this.bottomSpacer.style.height = `${window.afterExtent}px`;

    const firstCard = window.startIndex * GRID_COLUMNS;
    const lastCard = Math.min(total, window.endIndex * GRID_COLUMNS);
    const visible = this._viewModel.slice(firstCard, lastCard);

    const orderedCodes = this._viewModel.map((vm) => vm.code);

    // 焦点无需保存/恢复：keyed-update 只移动真正错位的节点。
    updateKeyedChildren(
      this.container,
      visible,
      (vm) => vm.code,
      (vm) => this.createCard(vm, orderedCodes),
      (node, vm) => this.updateCard(node, vm, orderedCodes),
      this.bottomSpacer
    );

    // 列表语义用完整列表的位置，而非窗口内的位置。
    let position = firstCard;
    for (const vm of visible) {
      const card = this.container.querySelector(`[data-key="${vm.code}"]`);
      if (card) {
        card.setAttribute('role', 'listitem');
        card.setAttribute('aria-setsize', String(total));
        card.setAttribute('aria-posinset', String(position + 1));
      }
      position += 1;
    }
  }

  private createCard(vm: StockCardViewModel, orderedCodes: readonly StockCode[]): HTMLElement {
    const card = document.createElement('stock-card') as StockCardElement;
    card.groupId = this._groupId;
    card.orderedCodes = orderedCodes;
    card.viewModel = vm;
    return card;
  }

  private updateCard(node: HTMLElement, vm: StockCardViewModel, orderedCodes: readonly StockCode[]): void {
    const card = node as unknown as StockCardElement;
    card.groupId = this._groupId;
    card.orderedCodes = orderedCodes;
    card.viewModel = vm;
  }
}
