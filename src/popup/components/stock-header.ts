// src/popup/components/stock-header.ts
// Task 15 Step 3 — 顶部头部组件。
// 三个原生按钮：添加股票（dialog-open-request）、多选模式（selection-mode-change）、
// 价格可见性（preferences-change）。aria-pressed 反映多选/价格隐藏状态。
// 架构约束：仅 import domain types + view-models + events；per-connection AbortController。
import type { HeaderViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';

export class StockHeaderElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: HeaderViewModel | null = null;

  private titleEl: HTMLElement | null = null;
  private addBtn: HTMLButtonElement | null = null;
  private multiselectBtn: HTMLButtonElement | null = null;
  private priceBtn: HTMLButtonElement | null = null;

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

  get viewModel(): HeaderViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: HeaderViewModel) {
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value);
  }

  private buildSkeleton(): void {
    const title = document.createElement('div');
    title.setAttribute('data-region', 'header-title');
    title.className = 'header-title';
    this.titleEl = title;

    const actions = document.createElement('div');
    actions.setAttribute('data-region', 'header-actions');
    actions.className = 'header-actions';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'header-btn header-btn--primary';
    addBtn.setAttribute('data-action', 'add-stock');
    addBtn.setAttribute('aria-label', '添加股票');
    addBtn.textContent = '添加股票';
    this.addBtn = addBtn;

    const multiselectBtn = document.createElement('button');
    multiselectBtn.type = 'button';
    multiselectBtn.className = 'header-btn header-btn--toggle';
    multiselectBtn.setAttribute('data-action', 'multiselect');
    multiselectBtn.setAttribute('aria-pressed', 'false');
    multiselectBtn.setAttribute('aria-label', '进入多选模式');
    multiselectBtn.textContent = '多选';
    this.multiselectBtn = multiselectBtn;

    const priceBtn = document.createElement('button');
    priceBtn.type = 'button';
    priceBtn.className = 'header-btn header-btn--toggle';
    priceBtn.setAttribute('data-action', 'price-visibility');
    priceBtn.setAttribute('aria-pressed', 'false');
    priceBtn.setAttribute('aria-label', '隐藏价格');
    priceBtn.textContent = '隐藏价格';
    this.priceBtn = priceBtn;

    actions.append(addBtn, multiselectBtn, priceBtn);
    this.append(title, actions);
  }

  private bindEvents(signal: AbortSignal): void {
    this.addBtn?.addEventListener('click', () => {
      emitPopupEvent(this, 'dialog-open-request', { kind: 'add-stock' });
    }, { signal });

    this.multiselectBtn?.addEventListener('click', () => {
      const enabled = !(this._viewModel?.selectionMode ?? false);
      emitPopupEvent(this, 'selection-mode-change', { enabled });
    }, { signal });

    this.priceBtn?.addEventListener('click', () => {
      const priceHidden = !(this._viewModel?.priceHidden ?? false);
      emitPopupEvent(this, 'preferences-change', { patch: { priceHidden } });
    }, { signal });
  }

  private applyViewModel(vm: HeaderViewModel): void {
    if (this.titleEl) {
      this.titleEl.textContent = `${vm.groupName}（${vm.stockCount}）`;
    }
    if (this.addBtn) {
      this.addBtn.disabled = !vm.canAddStock;
    }
    if (this.multiselectBtn) {
      this.multiselectBtn.setAttribute('aria-pressed', String(vm.selectionMode));
      const label = vm.selectionMode ? '退出多选模式' : '进入多选模式';
      this.multiselectBtn.setAttribute('aria-label', label);
      this.multiselectBtn.textContent = vm.selectionMode ? '退出多选' : '多选';
      this.multiselectBtn.classList.toggle('is-active', vm.selectionMode);
    }
    if (this.priceBtn) {
      this.priceBtn.setAttribute('aria-pressed', String(vm.priceHidden));
      const label = vm.priceHidden ? '显示价格' : '隐藏价格';
      this.priceBtn.setAttribute('aria-label', label);
      this.priceBtn.textContent = label;
      this.priceBtn.classList.toggle('is-active', vm.priceHidden);
    }
  }
}
