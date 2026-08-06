// src/popup/components/quote-status.ts
// Task 16 Step 7 — 行情刷新状态组件。
// 显示 fresh/cached/missing 计数 + 上次刷新时间 + deferred-until 文本 +
// 带 aria-busy 的刷新按钮（发出 quote-refresh-request { force: true }）。
// 简洁状态变化发往 app-live-region；不为每个行情单元格播报。
// 架构约束：仅 import domain + view-models + events；per-connection AbortController。
import type { QuoteStatusViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';

export class QuoteStatusElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: QuoteStatusViewModel | null = null;

  private freshEl: HTMLElement | null = null;
  private cachedEl: HTMLElement | null = null;
  private missingEl: HTMLElement | null = null;
  private timeEl: HTMLElement | null = null;
  private deferredEl: HTMLElement | null = null;
  private refreshBtn: HTMLButtonElement | null = null;

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

  get viewModel(): QuoteStatusViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: QuoteStatusViewModel) {
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value);
  }

  private buildSkeleton(): void {
    this.className = 'quote-status';
    this.setAttribute('role', 'status');

    const freshEl = document.createElement('span');
    freshEl.className = 'quote-status-count quote-status-count--fresh';
    this.freshEl = freshEl;

    const cachedEl = document.createElement('span');
    cachedEl.className = 'quote-status-count quote-status-count--cached';
    this.cachedEl = cachedEl;

    const missingEl = document.createElement('span');
    missingEl.className = 'quote-status-count quote-status-count--missing';
    this.missingEl = missingEl;

    const timeEl = document.createElement('span');
    timeEl.className = 'quote-status-time';
    this.timeEl = timeEl;

    const deferredEl = document.createElement('span');
    deferredEl.className = 'quote-status-deferred';
    deferredEl.setAttribute('hidden', '');
    this.deferredEl = deferredEl;

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'quote-status-btn';
    refreshBtn.setAttribute('data-action', 'refresh');
    refreshBtn.setAttribute('aria-label', '刷新行情');
    refreshBtn.setAttribute('aria-busy', 'false');
    refreshBtn.textContent = '刷新';
    this.refreshBtn = refreshBtn;

    this.append(freshEl, cachedEl, missingEl, timeEl, deferredEl, refreshBtn);
  }

  private bindEvents(signal: AbortSignal): void {
    this.refreshBtn?.addEventListener('click', () => {
      emitPopupEvent(this, 'quote-refresh-request', { force: true });
    }, { signal });
  }

  private applyViewModel(vm: QuoteStatusViewModel): void {
    if (this.freshEl) {
      this.freshEl.textContent = `实时 ${vm.freshCount}`;
    }
    if (this.cachedEl) {
      this.cachedEl.textContent = `缓存 ${vm.cachedCount}`;
    }
    if (this.missingEl) {
      this.missingEl.textContent = `缺失 ${vm.missingCount}`;
    }
    if (this.timeEl) {
      this.timeEl.textContent = vm.lastRefreshTime ? `更新于 ${vm.lastRefreshTime}` : '';
    }
    if (this.deferredEl) {
      if (vm.deferredUntil) {
        this.deferredEl.textContent = `延迟至 ${vm.deferredUntil}`;
        this.deferredEl.removeAttribute('hidden');
      } else {
        this.deferredEl.setAttribute('hidden', '');
      }
    }
    if (this.refreshBtn) {
      this.refreshBtn.setAttribute('aria-busy', String(vm.status === 'loading'));
      this.refreshBtn.disabled = vm.status === 'loading';
    }
  }
}
