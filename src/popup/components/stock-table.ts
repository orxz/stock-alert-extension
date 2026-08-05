// src/popup/components/stock-table.ts
// Task 16 Step 4 — 列表视图组件。
// Real table/thead/tbody + header 按钮 + aria-sort。行 keyed by stock code。
// 每行仅保留一个确定性菜单触发器；具体操作由统一 popover 承载。
// 架构约束：仅 import domain + view-models + events + keyed-update + 纯虚拟窗口计算；
// per-connection AbortController。
import type { StockCode, GroupId, SortField, SortDirection } from '../../domain/index.js';
import type { StockCardViewModel } from '../view-models.js';
import {
  calculateVirtualWindow,
  type VirtualViewport
} from '../virtualization/virtual-window.js';
import { emitPopupEvent } from './events.js';
import { updateKeyedChildren } from './keyed-update.js';
import { DEFAULT_UI_COLUMNS, normalizeUiColumns, type ColumnKey, type UiColumnPreferences } from '../ui-preferences.js';

const TABLE_HEADER_EXTENT = 28;
const TABLE_ROW_EXTENT = 48;
const OVERSCAN_SCREENS = 1;

const STATUS_LABELS: Readonly<Record<StockCardViewModel['status'], string>> = {
  fresh: '实时',
  cached: '缓存',
  missing: '缺失'
};

interface ColumnDef {
  readonly key: ColumnKey;
  readonly label: string;
  readonly sortField?: SortField;
}

const COLUMNS: readonly ColumnDef[] = [
  { key: 'name', label: '名称', sortField: 'name' },
  { key: 'code', label: '代码' },
  { key: 'price', label: '现价', sortField: 'price' },
  { key: 'changePercent', label: '涨跌幅', sortField: 'changePercent' },
  { key: 'amount', label: '成交额', sortField: 'amount' },
  { key: 'status', label: '状态' }
];

interface VisibleStock {
  readonly index: number;
  readonly viewModel: StockCardViewModel;
}

function setText(node: Element | undefined, value: string): void {
  if (node && node.textContent !== value) node.textContent = value;
}

function setAttribute(node: Element | undefined, name: string, value: string): void {
  if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export class StockTableElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: readonly StockCardViewModel[] = [];
  private _groupId: GroupId = 'g_all' as GroupId;
  private _sortField: SortField = 'manual';
  private _sortDirection: SortDirection = 'asc';
  private _columns: UiColumnPreferences = DEFAULT_UI_COLUMNS;
  private _viewport: VirtualViewport = { scrollOffset: 0, viewportExtent: 390 };
  private table: HTMLTableElement | null = null;
  private headerRow: HTMLTableRowElement | null = null;
  private tbody: HTMLTableSectionElement | null = null;
  private beforeSpacer: HTMLTableRowElement | null = null;
  private afterSpacer: HTMLTableRowElement | null = null;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    const signal = this.connection.signal;
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    this.bindEvents(signal);
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
  }

  get sortField(): SortField {
    return this._sortField;
  }

  set sortField(value: SortField) {
    this._sortField = value;
    if (this.isConnected) this.updateSortIndicators();
  }

  get sortDirection(): SortDirection {
    return this._sortDirection;
  }

  set sortDirection(value: SortDirection) {
    this._sortDirection = value;
    if (this.isConnected) this.updateSortIndicators();
  }

  get columns(): UiColumnPreferences {
    return this._columns;
  }

  set columns(value: UiColumnPreferences) {
    const normalized = normalizeUiColumns(value);
    const changed = JSON.stringify(normalized) !== JSON.stringify(this._columns);
    this._columns = normalized;
    if (changed && this.isConnected) this.rebuildColumns();
  }

  focusCode(code: StockCode): boolean {
    const index = this._viewModel.findIndex((vm) => vm.code === code);
    if (index < 0) return false;
    this.dispatchEvent(new CustomEvent('virtual-focus-request', {
      detail: { index, itemExtent: TABLE_ROW_EXTENT },
      bubbles: true,
      composed: true
    }));
    return true;
  }

  private buildSkeleton(): void {
    const table = document.createElement('table');
    table.className = 'stock-table';
    this.table = table;

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    this.headerRow = headerRow;
    thead.append(headerRow);

    const tbody = document.createElement('tbody');
    this.tbody = tbody;
    this.beforeSpacer = this.createSpacerRow('before');
    this.afterSpacer = this.createSpacerRow('after');
    tbody.append(this.beforeSpacer, this.afterSpacer);

    table.append(thead, tbody);
    this.append(table);
    this.rebuildColumns();
  }

  private rebuildColumns(): void {
    if (!this.headerRow || !this.tbody) return;
    this.headerRow.textContent = '';
    for (const col of this.activeColumns()) {
      const th = document.createElement('th');
      th.setAttribute('data-column', col.key);
      th.setAttribute('aria-sort', 'none');
      if (col.sortField) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'stock-table-sort-btn';
        btn.setAttribute('data-column', col.key);
        btn.setAttribute('data-sort-field', col.sortField);
        btn.textContent = col.label;
        th.append(btn);
      } else {
        const span = document.createElement('span');
        span.textContent = col.label;
        th.append(span);
      }
      this.headerRow.append(th);
    }
    // Actions column header (no sort)
    const actionsTh = document.createElement('th');
    actionsTh.textContent = '操作';
    this.headerRow.append(actionsTh);
    const columnCount = this.activeColumns().length + 1;
    const beforeCell = this.beforeSpacer?.firstElementChild as HTMLTableCellElement | null;
    const afterCell = this.afterSpacer?.firstElementChild as HTMLTableCellElement | null;
    if (beforeCell) beforeCell.colSpan = columnCount;
    if (afterCell) afterCell.colSpan = columnCount;
    for (const row of this.tbody.querySelectorAll('tr[data-key]')) row.remove();
    this.updateSortIndicators();
    this.render();
  }

  private activeColumns(): readonly ColumnDef[] {
    const enabled = new Set(this._columns.enabled);
    return this._columns.order
      .filter((key) => enabled.has(key))
      .map((key) => COLUMNS.find((column) => column.key === key))
      .filter((column): column is ColumnDef => column !== undefined);
  }

  private createSpacerRow(position: 'before' | 'after'): HTMLTableRowElement {
    const row = document.createElement('tr');
    row.className = `stock-table-spacer stock-table-spacer--${position}`;
    row.setAttribute('aria-hidden', 'true');
    const cell = document.createElement('td');
    cell.colSpan = this.activeColumns().length + 1;
    cell.style.padding = '0';
    cell.style.border = '0';
    row.append(cell);
    return row;
  }

  private bindEvents(signal: AbortSignal): void {
    // 事件委托：header 排序按钮
    this.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;

      // Header sort button
      const sortBtn = target.closest('button.stock-table-sort-btn') as HTMLButtonElement | null;
      if (sortBtn) {
        const field = sortBtn.getAttribute('data-sort-field') as SortField;
        if (field) {
          // Toggle direction if same field, otherwise default to asc (or desc for addedAt)
          const newDirection: SortDirection =
            this._sortField === field && this._sortDirection === 'asc' ? 'desc' : 'asc';
          emitPopupEvent(this, 'preferences-change', {
            patch: { sortField: field, sortDirection: newDirection }
          });
        }
        return;
      }

      // Row stock menu trigger
      const row = target.closest('tr[data-key]') as HTMLElement | null;
      if (!row) return;
      const code = row.getAttribute('data-key') as StockCode;
      if (!code) return;

      const actionBtn = target.closest('button[data-action]') as HTMLButtonElement | null;
      if (!actionBtn) return;
      const action = actionBtn.getAttribute('data-action');
      if (!action) return;

      if (action === 'stock-menu') {
        emitPopupEvent(this, 'stock-menu-open-request', {
          anchorId: `stock-actions-${code}`,
          code
        });
      }
    }, { signal });
  }

  private updateSortIndicators(): void {
    const ths = this.querySelectorAll('thead th[data-column]');
    for (const th of ths) {
      const colKey = th.getAttribute('data-column');
      const col = COLUMNS.find((c) => c.key === colKey);
      if (col?.sortField === this._sortField) {
        th.setAttribute('aria-sort', this._sortDirection === 'asc' ? 'ascending' : 'descending');
      } else {
        th.setAttribute('aria-sort', 'none');
      }
    }
  }

  private render(): void {
    if (!this.table || !this.tbody || !this.beforeSpacer || !this.afterSpacer) return;

    const focusedKey = (document.activeElement as HTMLElement | null)?.closest('tr[data-key]')?.getAttribute('data-key') ?? null;
    const virtualWindow = calculateVirtualWindow({
      itemCount: this._viewModel.length,
      itemExtent: TABLE_ROW_EXTENT,
      viewportExtent: Math.max(TABLE_ROW_EXTENT, this._viewport.viewportExtent - TABLE_HEADER_EXTENT),
      scrollOffset: this._viewport.scrollOffset,
      overscanScreens: OVERSCAN_SCREENS
    });
    const visibleStocks = this._viewModel
      .slice(virtualWindow.startIndex, virtualWindow.endIndex)
      .map((viewModel, offset): VisibleStock => ({
        index: virtualWindow.startIndex + offset,
        viewModel
      }));

    setAttribute(this.table, 'aria-rowcount', String(this._viewModel.length + 1));
    this.updateSpacer(this.beforeSpacer, virtualWindow.beforeExtent);
    this.updateSpacer(this.afterSpacer, virtualWindow.afterExtent);

    updateKeyedChildren(
      this.tbody,
      visibleStocks,
      ({ viewModel }) => viewModel.code,
      ({ index, viewModel }) => this.createRow(viewModel, index),
      (node, { index, viewModel }) => this.updateRow(node, viewModel, index),
      this.afterSpacer
    );

    // Restore focus to same row
    if (focusedKey) {
      const rowToFocus = this.tbody.querySelector(`tr[data-key="${focusedKey}"] button`);
      if (rowToFocus && !document.activeElement?.closest(`tr[data-key="${focusedKey}"]`)) {
        (rowToFocus as HTMLElement).focus?.();
      }
    }
  }

  private updateSpacer(row: HTMLTableRowElement, extent: number): void {
    const height = `${extent}px`;
    row.hidden = extent === 0;
    if (row.style.height !== height) row.style.height = height;
    const cell = row.firstElementChild as HTMLElement | null;
    if (cell && cell.style.height !== height) cell.style.height = height;
  }

  private createRow(vm: StockCardViewModel, index: number): HTMLElement {
    const tr = document.createElement('tr');
    tr.className = 'stock-table-row';
    for (const column of this.activeColumns()) {
      const cell = document.createElement('td');
      cell.className = `stock-table-cell stock-table-cell--${column.key === 'changePercent' ? 'change-percent' : column.key}`;
      cell.setAttribute('data-column', column.key);
      if (column.key === 'name') {
        const name = document.createElement('span');
        name.className = 'stock-table-name';
        cell.append(name);
      }
      tr.append(cell);
    }

    // Actions
    const actionsTd = document.createElement('td');
    actionsTd.className = 'stock-table-cell stock-table-cell--actions';

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'stock-table-btn';
    menuBtn.dataset.action = 'stock-menu';
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.textContent = '•••';
    actionsTd.append(menuBtn);

    tr.append(actionsTd);

    this.updateRow(tr, vm, index);
    return tr;
  }

  private updateRow(tr: HTMLElement, vm: StockCardViewModel, index: number): void {
    setAttribute(tr, 'aria-rowindex', String(index + 2));
    const cell = (key: ColumnKey): HTMLElement | undefined =>
      tr.querySelector<HTMLElement>(`td[data-column="${key}"]`) ?? undefined;
    const nameSpan = cell('name')?.querySelector('.stock-table-name');
    setText(nameSpan ?? undefined, vm.name);
    setText(cell('code'), vm.code);
    const priceCell = cell('price');
    if (priceCell) {
      const oldPrice = priceCell.textContent;
      setText(priceCell, vm.displayPrice);
      if (oldPrice !== vm.displayPrice && vm.displayPrice !== '--') {
        priceCell.classList.add('flash');
        setTimeout(() => priceCell.classList.remove('flash'), 250);
      }
    }
    const percentCell = cell('changePercent');
    if (percentCell) {
      setText(percentCell, vm.changePercent !== null ? `${vm.changePercent.toFixed(2)}%` : '--');
      percentCell.classList.toggle('is-up', vm.changePercent !== null && vm.changePercent > 0);
      percentCell.classList.toggle('is-down', vm.changePercent !== null && vm.changePercent < 0);
    }
    setText(cell('amount'), vm.displayAmount);
    const statusCell = cell('status');
    if (statusCell) {
      const label = vm.staleLabel || STATUS_LABELS[vm.status] || '';
      setText(statusCell, label);
    }
    const actions = tr.querySelector('.stock-table-cell--actions');
    const menuBtn = actions?.querySelector('button[data-action="stock-menu"]') as HTMLButtonElement | null;
    if (menuBtn) {
      menuBtn.id = `stock-actions-${vm.code}`;
      setAttribute(menuBtn, 'aria-label', `打开 ${vm.name} 操作菜单`);
    }
  }
}
