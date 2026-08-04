// src/popup/components/column-panel.ts
// Task 16 Step 6 — 列设置面板。
// checkboxes + up/down 控件；至少一列保持启用。
// 每次变更发出一次 preferences-change，含完整无重复的 columns 和 columnOrder。
// 架构约束：仅 import domain + view-models + events；per-connection AbortController。
import type { ColumnPanelViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';

export class ColumnPanelElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: ColumnPanelViewModel | null = null;
  private listEl: HTMLElement | null = null;

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

  get viewModel(): ColumnPanelViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: ColumnPanelViewModel) {
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value);
  }

  private buildSkeleton(): void {
    this.className = 'column-panel';
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', '列设置');

    const listEl = document.createElement('ul');
    listEl.className = 'column-panel-list';
    listEl.setAttribute('data-region', 'column-list');
    this.listEl = listEl;
    this.append(listEl);
  }

  private bindEvents(signal: AbortSignal): void {
    this.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      const btn = target.closest('button[data-action^="col-"]') as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;
      const action = btn.getAttribute('data-action')!;
      const item = btn.closest('[data-column-item]') as HTMLElement | null;
      if (!item) return;
      const colKey = item.getAttribute('data-column-item')!;
      this.handleMove(colKey, action);
    }, { signal });

    this.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLElement;
      const cb = target.closest('input[type="checkbox"][data-column]') as HTMLInputElement | null;
      if (!cb) return;
      const colKey = cb.getAttribute('data-column')!;
      this.handleToggle(colKey, cb.checked);
    }, { signal });
  }

  private handleToggle(colKey: string, checked: boolean): void {
    if (!this._viewModel) return;
    // Enforce: at least one column must stay enabled
    if (!checked) {
      const enabledCount = this._viewModel.columns.filter((c) => c.enabled).length;
      if (enabledCount <= 1) {
        // Prevent unchecking the last enabled column
        const cb = this.querySelector(`input[data-column="${colKey}"]`) as HTMLInputElement;
        if (cb) cb.checked = true;
        return;
      }
    }
    const columns = this._viewModel.columns
      .filter((c) => (c.key === colKey ? checked : c.enabled))
      .map((c) => c.key);
    emitPopupEvent(this, 'preferences-change', {
      patch: {},
      columns,
      columnOrder: [...this._viewModel.columnOrder]
    });
  }

  private handleMove(colKey: string, action: string): void {
    if (!this._viewModel) return;
    const order = [...this._viewModel.columnOrder];
    const i = order.indexOf(colKey);
    if (i < 0) return;
    const delta = action === 'col-up' ? -1 : 1;
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    const columns = this._viewModel.columns.filter((c) => c.enabled).map((c) => c.key);
    emitPopupEvent(this, 'preferences-change', {
      patch: {},
      columns,
      columnOrder: order
    });
  }

  private applyViewModel(vm: ColumnPanelViewModel): void {
    if (!this.listEl) return;
    this.listEl.textContent = '';

    for (let i = 0; i < vm.columnOrder.length; i++) {
      const colKey = vm.columnOrder[i];
      const col = vm.columns.find((c) => c.key === colKey);
      if (!col) continue;

      const li = document.createElement('li');
      li.className = 'column-panel-item';
      li.setAttribute('data-column-item', colKey);

      const label = document.createElement('label');
      label.className = 'column-panel-label';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'column-panel-checkbox';
      cb.setAttribute('data-column', colKey);
      cb.setAttribute('aria-label', col.label);
      cb.checked = col.enabled;

      const labelText = document.createElement('span');
      labelText.textContent = col.label;

      label.append(cb, labelText);

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'column-panel-btn';
      upBtn.setAttribute('data-action', 'col-up');
      upBtn.setAttribute('aria-label', `上移 ${col.label}`);
      upBtn.textContent = '↑';
      upBtn.disabled = i === 0;

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'column-panel-btn';
      downBtn.setAttribute('data-action', 'col-down');
      downBtn.setAttribute('aria-label', `下移 ${col.label}`);
      downBtn.textContent = '↓';
      downBtn.disabled = i === vm.columnOrder.length - 1;

      li.append(label, upBtn, downBtn);
      this.listEl.append(li);
    }
  }
}
