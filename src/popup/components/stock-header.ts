// src/popup/components/stock-header.ts
// Task 5 — 顶部头部组件（A1 布局）。
// 四个原生按钮（图标 + 文字标签）：主题切换（theme-change）、价格可见性（preferences-change）、
// 多选模式（selection-mode-change）、添加股票（dialog-open-request）。
// aria-pressed 反映多选/价格隐藏状态。主题按钮标签随当前主题变化（提示可切换到的目标主题）。
// 架构约束：仅 import domain types + view-models + events；per-connection AbortController。
import type { HeaderViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';

export class StockHeaderElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: HeaderViewModel | null = null;

  private titleEl: HTMLElement | null = null;
  private themeBtn: HTMLButtonElement | null = null;
  private priceBtn: HTMLButtonElement | null = null;
  private multiselectBtn: HTMLButtonElement | null = null;
  private addBtn: HTMLButtonElement | null = null;

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

    // 1. 主题切换（半圆图标）
    const themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.className = 'header-btn header-btn--labeled';
    themeBtn.setAttribute('data-action', 'theme-toggle');
    themeBtn.setAttribute('aria-label', '切换到浅色主题');
    themeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg><span class="header-btn-label">浅色</span>';
    this.themeBtn = themeBtn;

    // 2. 价格可见性（眼睛图标）
    const priceBtn = document.createElement('button');
    priceBtn.type = 'button';
    priceBtn.className = 'header-btn header-btn--labeled header-btn--toggle';
    priceBtn.setAttribute('data-action', 'price-visibility');
    priceBtn.setAttribute('aria-pressed', 'false');
    priceBtn.setAttribute('aria-label', '价格');
    priceBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg><span class="header-btn-label">价格</span>';
    this.priceBtn = priceBtn;

    // 3. 多选模式（勾选框图标）
    const multiselectBtn = document.createElement('button');
    multiselectBtn.type = 'button';
    multiselectBtn.className = 'header-btn header-btn--labeled header-btn--toggle';
    multiselectBtn.setAttribute('data-action', 'multiselect');
    multiselectBtn.setAttribute('aria-pressed', 'false');
    multiselectBtn.setAttribute('aria-label', '多选');
    multiselectBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 12.2l2.6 2.6 4.6-5.2"/></svg><span class="header-btn-label">多选</span>';
    this.multiselectBtn = multiselectBtn;

    // 4. 添加股票（加号图标，主按钮）
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'header-btn header-btn--labeled header-btn--primary';
    addBtn.setAttribute('data-action', 'add-stock');
    addBtn.setAttribute('aria-label', '添加股票');
    addBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span class="header-btn-label">添加</span>';
    this.addBtn = addBtn;

    actions.append(themeBtn, priceBtn, multiselectBtn, addBtn);
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

    this.themeBtn?.addEventListener('click', () => {
      const next = (this._viewModel?.theme ?? 'dark') === 'dark' ? 'light' : 'dark';
      emitPopupEvent(this, 'theme-change', { theme: next });
    }, { signal });
  }

  private applyViewModel(vm: HeaderViewModel): void {
    if (this.titleEl) {
      this.titleEl.textContent = `${vm.groupName} · ${vm.stockCount}`;
    }
    if (this.addBtn) {
      this.addBtn.disabled = !vm.canAddStock;
    }
    if (this.themeBtn) {
      const isDark = vm.theme === 'dark';
      const label = isDark ? '浅色' : '深色';
      const target = isDark ? '浅色' : '深色';
      const span = this.themeBtn.querySelector('.header-btn-label');
      if (span) span.textContent = label;
      this.themeBtn.setAttribute('aria-label', `切换到${target}主题`);
    }
    if (this.multiselectBtn) {
      this.multiselectBtn.setAttribute('aria-pressed', String(vm.selectionMode));
      this.multiselectBtn.classList.toggle('is-active', vm.selectionMode);
    }
    if (this.priceBtn) {
      this.priceBtn.setAttribute('aria-pressed', String(vm.priceHidden));
      this.priceBtn.classList.toggle('is-active', vm.priceHidden);
    }
  }
}
