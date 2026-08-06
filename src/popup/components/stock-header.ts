// src/popup/components/stock-header.ts
// Task 5 — 顶部头部组件（A1 布局）。
// 三个原生按钮（图标 + 文字标签）：主题切换（theme-change）、价格可见性（preferences-change）、
// 添加股票（dialog-open-request）。「管理持仓」已移到 group-tabs 右侧，不在此组件。
// aria-pressed 反映价格隐藏状态。主题按钮标签随当前主题变化（提示可切换到的目标主题）。
// 架构约束：仅 import domain types + view-models + events；per-connection AbortController。
import type { HeaderViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';

/** 睁眼图标：眼睛轮廓 + 瞳孔圆。 */
const EYE_OPEN_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';

/** 闭眼图标：眼睛轮廓 + 斜划线，无瞳孔。 */
const EYE_CLOSED_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';

export class StockHeaderElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: HeaderViewModel | null = null;

  private titleEl: HTMLElement | null = null;
  private themeBtn: HTMLButtonElement | null = null;
  private priceBtn: HTMLButtonElement | null = null;
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
    themeBtn.className = 'header-btn';
    themeBtn.setAttribute('data-action', 'theme-toggle');
    themeBtn.setAttribute('aria-label', '切换到浅色主题');
    themeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg><span class="header-btn-label">浅色</span>';
    this.themeBtn = themeBtn;

    // 2. 价格可见性（眼睛图标）——初始用睁眼，applyViewModel 按 priceHidden 切换。
    const priceBtn = document.createElement('button');
    priceBtn.type = 'button';
    priceBtn.className = 'header-btn header-btn--toggle';
    priceBtn.setAttribute('data-action', 'price-visibility');
    priceBtn.setAttribute('aria-pressed', 'false');
    priceBtn.setAttribute('aria-label', '价格');
    priceBtn.innerHTML = EYE_OPEN_SVG + '<span class="header-btn-label">价格</span>';
    this.priceBtn = priceBtn;

    // 3. 添加股票（主按钮，纯中文文案）。
    // 四个字把动作说清楚，也不需要用户猜「+」加的是什么。
    // aria-label 补全为「添加股票」。
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'header-btn header-btn--primary';
    addBtn.setAttribute('data-action', 'add-stock');
    addBtn.setAttribute('aria-label', '添加股票');
    addBtn.textContent = '添加股票';
    this.addBtn = addBtn;

    actions.append(themeBtn, priceBtn, addBtn);
    this.append(title, actions);
  }

  private bindEvents(signal: AbortSignal): void {
    this.addBtn?.addEventListener('click', () => {
      emitPopupEvent(this, 'dialog-open-request', { kind: 'add-stock' });
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
    if (this.priceBtn) {
      this.priceBtn.setAttribute('aria-pressed', String(vm.priceHidden));
      this.priceBtn.classList.toggle('is-active', vm.priceHidden);
      // 睁眼/闭眼图标随价格可见性切换——闭眼时带斜划线，更直观。
      this.updatePriceIcon(vm.priceHidden);
    }
  }

  /** 按 priceHidden 切换价格按钮的睁眼/闭眼 SVG。 */
  private updatePriceIcon(priceHidden: boolean): void {
    if (!this.priceBtn) return;
    const svg = this.priceBtn.querySelector('svg');
    const target = priceHidden ? EYE_CLOSED_SVG : EYE_OPEN_SVG;
    if (!svg) {
      this.priceBtn.innerHTML = target + '<span class="header-btn-label">价格</span>';
    } else {
      svg.outerHTML = target;
    }
  }
}
