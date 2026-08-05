// src/popup/components/stock-table.ts
// Task 16 Step 4 — 列表视图组件。
// Real table/thead/tbody + header 按钮 + aria-sort。行 keyed by stock code。
// 行内 pin/up/down 按钮复用 moveKey helper，与 stock-card 行为一致。
// 架构约束：仅 import domain + view-models + events + keyed-update；per-connection AbortController。
import type { StockCode, GroupId, SortField, SortDirection } from '../../domain/index.js';
import type { StockCardViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';
import { moveKey } from './stock-card.js';
import { updateKeyedChildren } from './keyed-update.js';
import { calculateVirtualWindow } from '../virtualization/virtual-window.js';
import type { VirtualViewport } from '../virtualization/virtual-window.js';

/** 单行高度（px）——与 board.css 的 .stock-table-row 固定高度一致。 */
const TABLE_ROW_EXTENT = 48;
/** 表头高度（px），stock-board 计算 scrollOffset 时会扣除。 */
export const TABLE_HEADER_EXTENT = 28;
/** 视口上下各多渲染一屏，滚动时不出现空白。 */
const OVERSCAN_SCREENS = 1;

/** 仅在文本确实变化时写入，避免无谓的 DOM 写与样式失效。 */
function setText(node: Element | null | undefined, value: string): void {
  if (node && node.textContent !== value) node.textContent = value;
}

/** 仅在属性确实变化时写入。 */
function setAttr(node: Element | null | undefined, name: string, value: string): void {
  if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
}

const STATUS_LABELS: Readonly<Record<StockCardViewModel['status'], string>> = {
  fresh: '实时',
  cached: '缓存',
  missing: '缺失'
};

interface ColumnDef {
  readonly key: string;
  readonly label: string;
  readonly sortField?: SortField;
}

const COLUMNS: readonly ColumnDef[] = [
  { key: 'name', label: '名称', sortField: 'name' },
  { key: 'code', label: '代码' },
  { key: 'price', label: '现价', sortField: 'price' },
  { key: 'change', label: '涨跌额', sortField: 'change' },
  { key: 'changePercent', label: '涨跌幅', sortField: 'changePercent' },
  { key: 'amount', label: '成交额', sortField: 'amount' },
  { key: 'status', label: '状态' }
];

/** 创建一个对辅助技术隐藏的 spacer 行（撑高度用，不是数据行）。 */
function createSpacerRow(columnCount: number): HTMLElement {
  const tr = document.createElement('tr');
  tr.setAttribute('data-spacer', '');
  tr.setAttribute('aria-hidden', 'true');
  const td = document.createElement('td');
  td.colSpan = columnCount;
  td.setAttribute('aria-hidden', 'true');
  tr.append(td);
  tr.style.height = '0px';
  return tr;
}

export class StockTableElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: readonly StockCardViewModel[] = [];
  private _groupId: GroupId = 'g_all' as GroupId;
  private _sortField: SortField = 'manual';
  private _sortDirection: SortDirection = 'asc';
  private tbody: HTMLElement | null = null;
  private table: HTMLTableElement | null = null;
  private topSpacer: HTMLElement | null = null;
  private bottomSpacer: HTMLElement | null = null;
  /** 视口由 stock-board（唯一滚动拥有者）推送；默认值覆盖未挂载时的渲染。 */
  private _viewport: VirtualViewport = { scrollOffset: 0, viewportExtent: 390 };

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

  get groupId(): GroupId {
    return this._groupId;
  }

  set groupId(value: GroupId) {
    this._groupId = value;
  }

  get viewport(): VirtualViewport {
    return this._viewport;
  }

  set viewport(value: VirtualViewport) {
    this._viewport = value;
    if (this.isConnected) this.render();
  }

  /**
   * 请求把 `code` 滚入视口。目标行可能在虚拟窗口之外、尚未挂载，
   * 因此这里只发出请求，由 stock-board 滚动后再聚焦。
   * @returns code 是否存在于当前列表
   */
  focusCode(code: StockCode): boolean {
    const index = this._viewModel.findIndex((vm) => vm.code === code);
    if (index < 0) return false;
    emitPopupEvent(this, 'virtual-focus-request', { index, itemExtent: TABLE_ROW_EXTENT });
    return true;
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

  private buildSkeleton(): void {
    const table = document.createElement('table');
    table.className = 'stock-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const col of COLUMNS) {
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
      headerRow.append(th);
    }
    // Actions column header (no sort)
    const actionsTh = document.createElement('th');
    actionsTh.textContent = '操作';
    headerRow.append(actionsTh);

    thead.append(headerRow);

    const tbody = document.createElement('tbody');
    this.tbody = tbody;

    // 上下 spacer：撑出未渲染行占据的高度，让滚动条长度与完整列表一致。
    // 对辅助技术隐藏——它们不是数据行。
    const columnCount = COLUMNS.length + 1;
    this.topSpacer = createSpacerRow(columnCount);
    this.bottomSpacer = createSpacerRow(columnCount);
    tbody.append(this.topSpacer, this.bottomSpacer);

    table.append(thead, tbody);
    this.table = table;
    this.append(table);

    this.updateSortIndicators();
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

      // Row action buttons (pin/up/down)
      const row = target.closest('tr[data-key]') as HTMLElement | null;
      if (!row) return;
      const code = row.getAttribute('data-key') as StockCode;
      if (!code) return;

      const actionBtn = target.closest('button[data-action]') as HTMLButtonElement | null;
      if (!actionBtn) return;
      const action = actionBtn.getAttribute('data-action');
      if (!action) return;

      const orderedCodes = this._viewModel.map((vm) => vm.code);

      if (action === 'pin') {
        const vm = this._viewModel.find((v) => v.code === code);
        if (vm) {
          const newPinned = !vm.pinned;
          const newOrdered = newPinned
            ? [code, ...orderedCodes.filter((c) => c !== code)]
            : [...orderedCodes];
          emitPopupEvent(this, 'stock-pin-request', {
            code,
            pinned: newPinned,
            orderedCodes: newOrdered
          });
        }
      } else if (action === 'move-up') {
        emitPopupEvent(this, 'stock-order-request', {
          groupId: this._groupId,
          orderedCodes: moveKey(orderedCodes, code, -1)
        });
      } else if (action === 'move-down') {
        emitPopupEvent(this, 'stock-order-request', {
          groupId: this._groupId,
          orderedCodes: moveKey(orderedCodes, code, 1)
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
    if (!this.tbody) return;

    const total = this._viewModel.length;
    const window = calculateVirtualWindow({
      itemCount: total,
      itemExtent: TABLE_ROW_EXTENT,
      viewportExtent: this._viewport.viewportExtent,
      scrollOffset: this._viewport.scrollOffset,
      overscanScreens: OVERSCAN_SCREENS
    });

    // 语义行数始终反映完整列表（表头占第 1 行），与实际挂载的窗口无关——
    // 否则屏幕阅读器会把「500 选 27」读成「共 27 行」。
    setAttr(this.table, 'aria-rowcount', String(total + 1));

    if (this.topSpacer) this.topSpacer.style.height = `${window.beforeExtent}px`;
    if (this.bottomSpacer) this.bottomSpacer.style.height = `${window.afterExtent}px`;

    const visible = this._viewModel.slice(window.startIndex, window.endIndex);

    // 不再保存/恢复焦点：keyed-update 只移动真正错位的节点，
    // 位置不变的行不会被重新插入，焦点自然保留。
    updateKeyedChildren(
      this.tbody,
      visible,
      (vm) => vm.code,
      (vm) => this.createRow(vm),
      (node, vm) => this.updateRow(node, vm),
      // 所有数据行必须排在底部 spacer 之前。
      this.bottomSpacer
    );

    // aria-rowindex 用完整列表中的位置（+2：表头占 1，索引从 0 起）。
    let index = window.startIndex;
    for (const vm of visible) {
      const row = this.tbody.querySelector(`tr[data-key="${vm.code}"]`);
      setAttr(row, 'aria-rowindex', String(index + 2));
      index += 1;
    }
  }

  private createRow(vm: StockCardViewModel): HTMLElement {
    const tr = document.createElement('tr');
    tr.className = 'stock-table-row';

    // Name
    const nameTd = document.createElement('td');
    nameTd.className = 'stock-table-cell stock-table-cell--name';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'stock-table-name';
    nameSpan.setAttribute('data-field', 'name');
    nameTd.append(nameSpan);

    // Code
    const codeTd = document.createElement('td');
    codeTd.className = 'stock-table-cell stock-table-cell--code';

    // Price
    const priceTd = document.createElement('td');
    priceTd.className = 'stock-table-cell stock-table-cell--price';
    priceTd.setAttribute('data-field', 'price');

    // Change
    const changeTd = document.createElement('td');
    changeTd.className = 'stock-table-cell stock-table-cell--change';

    // Change percent
    const pctTd = document.createElement('td');
    pctTd.className = 'stock-table-cell stock-table-cell--change-percent';

    // Amount
    const amountTd = document.createElement('td');
    amountTd.className = 'stock-table-cell stock-table-cell--amount';

    // Status
    const statusTd = document.createElement('td');
    statusTd.className = 'stock-table-cell stock-table-cell--status';

    // Actions
    const actionsTd = document.createElement('td');
    actionsTd.className = 'stock-table-cell stock-table-cell--actions';

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'stock-table-btn';
    pinBtn.setAttribute('data-action', 'pin');
    actionsTd.append(pinBtn);

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'stock-table-btn';
    upBtn.setAttribute('data-action', 'move-up');
    upBtn.textContent = '↑';
    actionsTd.append(upBtn);

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'stock-table-btn';
    downBtn.setAttribute('data-action', 'move-down');
    downBtn.textContent = '↓';
    actionsTd.append(downBtn);

    tr.append(nameTd, codeTd, priceTd, changeTd, pctTd, amountTd, statusTd, actionsTd);

    this.updateRow(tr, vm);
    return tr;
  }

  private updateRow(tr: HTMLElement, vm: StockCardViewModel): void {
    const cells = tr.children;
    // Name
    const nameSpan = cells[0]?.querySelector('.stock-table-name');
    if (nameSpan) nameSpan.textContent = vm.name;
    // Code
    if (cells[1]) cells[1].textContent = vm.code;
    // Price (flash on real change)
    if (cells[2]) {
      const priceCell = cells[2] as HTMLElement;
      const oldPrice = priceCell.textContent;
      priceCell.textContent = vm.displayPrice;
      if (oldPrice !== vm.displayPrice && vm.displayPrice !== '--') {
        priceCell.classList.add('flash');
        setTimeout(() => priceCell.classList.remove('flash'), 250);
      }
    }
    // Change
    if (cells[3]) {
      cells[3].textContent = vm.change !== null ? vm.change.toFixed(2) : '--';
      cells[3].classList.toggle('is-up', vm.change !== null && vm.change > 0);
      cells[3].classList.toggle('is-down', vm.change !== null && vm.change < 0);
    }
    // Change percent
    if (cells[4]) {
      cells[4].textContent = vm.changePercent !== null ? `${vm.changePercent.toFixed(2)}%` : '--';
      cells[4].classList.toggle('is-up', vm.changePercent !== null && vm.changePercent > 0);
      cells[4].classList.toggle('is-down', vm.changePercent !== null && vm.changePercent < 0);
    }
    // Amount
    if (cells[5]) {
      cells[5].textContent = vm.displayAmount;
    }
    // Status（data-stale 只在确实过期时出现——它表达状态，不是字段锚点）
    if (cells[6]) {
      const label = vm.staleLabel || STATUS_LABELS[vm.status] || '';
      setText(cells[6], label);
      cells[6].toggleAttribute('data-stale', Boolean(vm.staleLabel));
    }
    // Actions
    const pinBtn = cells[7]?.querySelector('button[data-action="pin"]') as HTMLButtonElement | null;
    if (pinBtn) {
      pinBtn.setAttribute('aria-pressed', String(vm.pinned));
      pinBtn.setAttribute('aria-label', vm.pinned ? `取消置顶 ${vm.name}` : `置顶 ${vm.name}`);
      pinBtn.textContent = vm.pinned ? '📌' : '📍';
    }
    const upBtn = cells[7]?.querySelector('button[data-action="move-up"]') as HTMLButtonElement | null;
    if (upBtn) upBtn.setAttribute('aria-label', `上移 ${vm.name}`);
    const downBtn = cells[7]?.querySelector('button[data-action="move-down"]') as HTMLButtonElement | null;
    if (downBtn) downBtn.setAttribute('aria-label', `下移 ${vm.name}`);
  }
}
