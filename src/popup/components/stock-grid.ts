// src/popup/components/stock-grid.ts
// Task 16 Step 3-5 — 网格视图容器组件。
// 使用 keyed-update 保持卡片节点 identity/focus/scroll 稳定。
// 事件委托：在 grid 容器上监听 stock-card 的 pin/order 事件并转发。
// 架构约束：仅 import domain + view-models + events + keyed-update；per-connection AbortController。
import type { StockCode, GroupId } from '../../domain/brands.js';
import type { StockCardViewModel } from '../view-models.js';
import { updateKeyedChildren } from './keyed-update.js';
import './stock-card.js';
import type { StockCardElement } from './stock-card.js';

export class StockGridElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: readonly StockCardViewModel[] = [];
  private _groupId: GroupId = 'g_all' as GroupId;
  private container: HTMLElement | null = null;

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

  private buildSkeleton(): void {
    const container = document.createElement('div');
    container.className = 'stock-grid-container';
    container.setAttribute('data-region', 'grid-cards');
    this.container = container;
    this.append(container);
  }

  private render(): void {
    if (!this.container) return;

    // 记录当前焦点所在的 data-key，渲染后恢复焦点到同一卡片。
    const focusedKey = (document.activeElement as HTMLElement | null)?.closest('[data-key]')?.getAttribute('data-key') ?? null;

    const orderedCodes = this._viewModel.map((vm) => vm.code);

    updateKeyedChildren(
      this.container,
      this._viewModel,
      (vm) => vm.code,
      (vm) => this.createCard(vm, orderedCodes),
      (node, vm) => this.updateCard(node, vm, orderedCodes)
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
