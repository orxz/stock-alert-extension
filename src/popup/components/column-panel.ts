import type { ColumnPanelViewModel } from '../view-models.js';
import {
  REQUIRED_COLUMNS,
  normalizeUiColumns,
  type ColumnKey
} from '../ui-preferences.js';
import { emitPopupEvent } from './events.js';

const COLUMN_LABELS: Readonly<Record<ColumnKey, string>> = {
  name: '名称',
  code: '代码',
  status: '状态',
  price: '现价',
  changePercent: '涨跌幅',
  amount: '成交额'
};
const REQUIRED_SET = new Set<ColumnKey>(REQUIRED_COLUMNS);

export class ColumnPanelElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: ColumnPanelViewModel | null = null;
  private listEl: HTMLElement | null = null;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    this.bindEvents(this.connection.signal);
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
    this.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest('button[data-action^="col-"]') as HTMLButtonElement | null;
      if (!button || button.disabled) return;
      const item = button.closest('[data-column-item]');
      const key = item?.getAttribute('data-column-item') as ColumnKey | null;
      if (key) this.handleMove(key, button.getAttribute('data-action'));
    }, { signal });

    this.addEventListener('change', (event) => {
      const target = event.target as HTMLElement;
      const checkbox = target.closest('input[type="checkbox"][data-column]') as HTMLInputElement | null;
      const key = checkbox?.getAttribute('data-column') as ColumnKey | null;
      if (checkbox && key) this.handleToggle(key, checkbox.checked);
    }, { signal });
  }

  private handleToggle(key: ColumnKey, checked: boolean): void {
    if (!this._viewModel) return;
    if (REQUIRED_SET.has(key) && !checked) {
      const checkbox = this.querySelector(`input[data-column="${key}"]`) as HTMLInputElement | null;
      if (checkbox) checkbox.checked = true;
      return;
    }

    const previous = this._viewModel.columns;
    const enabled = checked
      ? [...previous.enabled, key]
      : previous.enabled.filter((column) => column !== key);
    this.emitColumns({ version: 1, enabled, order: previous.order });
  }

  private handleMove(key: ColumnKey, action: string | null): void {
    if (!this._viewModel) return;
    const order = [...this._viewModel.columns.order];
    const index = order.indexOf(key);
    const target = index + (action === 'col-up' ? -1 : 1);
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    this.emitColumns({ version: 1, enabled: this._viewModel.columns.enabled, order });
  }

  private emitColumns(value: unknown): void {
    emitPopupEvent(this, 'column-settings-change', { columns: normalizeUiColumns(value) });
  }

  private applyViewModel(vm: ColumnPanelViewModel): void {
    if (!this.listEl) return;
    this.listEl.textContent = '';
    const enabled = new Set(vm.columns.enabled);

    vm.columns.order.forEach((key, index) => {
      const labelText = COLUMN_LABELS[key];
      const item = document.createElement('li');
      item.className = 'column-panel-item';
      item.setAttribute('data-column-item', key);

      const label = document.createElement('label');
      label.className = 'column-panel-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'column-panel-checkbox';
      checkbox.setAttribute('data-column', key);
      checkbox.setAttribute('aria-label', labelText);
      checkbox.checked = enabled.has(key);
      checkbox.disabled = REQUIRED_SET.has(key);
      const text = document.createElement('span');
      text.textContent = labelText;
      label.append(checkbox, text);

      const up = this.moveButton('col-up', `上移 ${labelText}`, '↑', index === 0);
      const down = this.moveButton('col-down', `下移 ${labelText}`, '↓', index === vm.columns.order.length - 1);
      item.append(label, up, down);
      this.listEl?.append(item);
    });
  }

  private moveButton(action: 'col-up' | 'col-down', label: string, text: string, disabled: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'column-panel-btn';
    button.setAttribute('data-action', action);
    button.setAttribute('aria-label', label);
    button.textContent = text;
    button.disabled = disabled;
    return button;
  }
}
