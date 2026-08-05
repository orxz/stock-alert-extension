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

/**
 * A 股单日涨跌停幅度（%）。
 * 涨跌幅列的幅度条以此归一化——这是本地市场独有的刻度，
 * 也是每个投资者判断「离涨停还有多远」的心智基准。
 */
const LIMIT_PCT = 10;

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

/**
 * 真实表格列：股票 / 现价 / 涨跌幅 / 成交额，外加固定的操作列。
 *
 * 为什么只有四列：Popup 宽 420px。上一版把 名称/代码/现价/涨跌额/涨跌幅/
 * 成交额/状态 七列全部平铺，每列分不到 50px，结果全部截断成「贵…」「+10…」——
 * 数据再准确也读不出来。代码与行情状态改为**股票列的副标题**（见 SUBLINE_KEYS），
 * 既保留可配置性，又把宽度让给真正要扫的数字。
 */
const COLUMNS: readonly ColumnDef[] = [
  { key: 'name', label: '股票', sortField: 'name' },
  { key: 'price', label: '现价', sortField: 'price' },
  { key: 'changePercent', label: '涨跌幅', sortField: 'changePercent' },
  { key: 'amount', label: '成交额', sortField: 'amount' }
];

/** 以副标题形式挂在股票列下的可选信息（仍由列设置控制显隐）。 */
const SUBLINE_KEYS = ['code', 'status'] as const;

/**
 * 行操作触发器的确定性 id——popover 用它定位并在关闭时归还焦点。
 * 必须稳定：虚拟窗口滚动时节点会被复用，随机 id 会让焦点归还失效。
 */
export function rowMenuId(code: string): string {
  return `stock-actions-${code}`;
}

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
  /** 启用的列（展示偏好）。空数组表示「未配置」，按全部列渲染。 */
  private _columns: readonly string[] = [];

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

  get columns(): readonly string[] {
    return this._columns;
  }

  set columns(value: readonly string[] | undefined) {
    this._columns = Array.isArray(value) ? value : [];
    if (this.isConnected) this.applyColumnVisibility();
  }

  /**
   * 按启用集合显隐列与副标题字段。
   * 用 hidden 属性而非移除节点——列切换是高频轻量操作，重建整张表会丢焦点、
   * 丢滚动位置。股票列与操作列始终可见（股票列是必需列）。
   */
  private applyColumnVisibility(): void {
    if (!this.table) return;
    const enabled = this._columns.length > 0 ? new Set(this._columns) : null;
    const isOn = (key: string): boolean => enabled === null || enabled.has(key);

    for (const col of COLUMNS) {
      const visible = isOn(col.key);
      const th = this.table.querySelector(`thead th[data-column="${col.key}"]`);
      if (th) (th as HTMLElement).hidden = !visible;
      for (const td of this.querySelectorAll<HTMLElement>(
        `tbody [data-column="${col.key}"]`
      )) {
        td.hidden = !visible;
      }
    }

    // 副标题字段（代码 / 状态）不是独立列，单独控制。
    for (const key of SUBLINE_KEYS) {
      const visible = isOn(key);
      for (const el of this.querySelectorAll<HTMLElement>(`[data-subline="${key}"]`)) {
        el.hidden = !visible;
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
   * 请求把 `code` 滚入视口。目标行可能在虚拟窗口之外、尚未挂载，
   * 因此这里只发出请求，由 stock-board 滚动后再聚焦。
   * @returns code 是否存在于当前列表
   */
  focusCode(code: StockCode): boolean {
    const index = this._viewModel.findIndex((vm) => vm.code === code);
    if (index < 0) return false;
    emitPopupEvent(this, 'virtual-focus-request', { index, itemExtent: TABLE_ROW_EXTENT, code });
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

      if (action === 'stock-menu') {
        emitPopupEvent(this, 'stock-menu-open-request', {
          anchorId: actionBtn.id || rowMenuId(code),
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

    // 新进入窗口的行也要套用当前列显隐。
    this.applyColumnVisibility();
  }

  private createRow(vm: StockCardViewModel): HTMLElement {
    const tr = document.createElement('tr');
    tr.className = 'stock-table-row';

    // 股票列：名称 + 副标题（代码 · 行情状态）
    const nameTd = document.createElement('td');
    nameTd.className = 'stock-table-cell stock-table-cell--name';
    nameTd.setAttribute('data-column', 'name');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'stock-table-name';
    nameSpan.setAttribute('data-field', 'name');
    const subline = document.createElement('span');
    subline.className = 'stock-table-subline';
    const codeSpan = document.createElement('span');
    codeSpan.className = 'stock-table-code';
    codeSpan.setAttribute('data-subline', 'code');
    const statusSpan = document.createElement('span');
    statusSpan.className = 'stock-table-status';
    statusSpan.setAttribute('data-subline', 'status');
    subline.append(codeSpan, statusSpan);
    nameTd.append(nameSpan, subline);

    const priceTd = document.createElement('td');
    priceTd.className = 'stock-table-cell stock-table-cell--price';
    priceTd.setAttribute('data-column', 'price');
    priceTd.setAttribute('data-field', 'price');

    const pctTd = document.createElement('td');
    pctTd.className = 'stock-table-cell stock-table-cell--change-percent';
    pctTd.setAttribute('data-column', 'changePercent');

    const amountTd = document.createElement('td');
    amountTd.className = 'stock-table-cell stock-table-cell--amount';
    amountTd.setAttribute('data-column', 'amount');

    const actionsTd = document.createElement('td');
    actionsTd.className = 'stock-table-cell stock-table-cell--actions';

    // 单一 ••• 触发器取代原来的 置顶/↑/↓ 三连按钮：
    // 420px 宽的 Popup 里每行塞三个按钮既挤又难点中（触控目标不达标），
    // 具体动作交给 stock-action-menu。
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'stock-table-btn stock-row-menu-trigger';
    menuBtn.setAttribute('data-action', 'stock-menu');
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.textContent = '•••';
    actionsTd.append(menuBtn);

    tr.append(nameTd, priceTd, pctTd, amountTd, actionsTd);

    this.updateRow(tr, vm);
    return tr;
  }

  private updateRow(tr: HTMLElement, vm: StockCardViewModel): void {
    // 按 data-column 取单元格，而不是按下标——列结构变化时下标会整体错位，
    // 这正是上一版把状态文字写进操作列那类问题的来源。
    const cell = (key: string): HTMLElement | null =>
      tr.querySelector(`[data-column="${key}"]`);

    // 股票：名称 + 副标题（代码 · 状态）
    setText(tr.querySelector('.stock-table-name'), vm.name);
    setText(tr.querySelector('[data-subline="code"]'), vm.code);
    const statusEl = tr.querySelector('[data-subline="status"]');
    if (statusEl) {
      setText(statusEl, vm.staleLabel || STATUS_LABELS[vm.status] || '');
      // data-stale 只在确实过期时出现——它表达状态，不是字段锚点。
      statusEl.toggleAttribute('data-stale', Boolean(vm.staleLabel));
    }

    // 现价（真实变化时闪烁）
    const priceCell = cell('price');
    if (priceCell) {
      const previous = priceCell.textContent;
      setText(priceCell, vm.displayPrice);
      if (previous && previous !== vm.displayPrice && vm.displayPrice !== '--') {
        priceCell.classList.add('flash');
        setTimeout(() => priceCell.classList.remove('flash'), 250);
      }
    }

    // 涨跌幅（含幅度条：宽度按 |涨跌幅| 相对 A 股 ±10% 涨跌停归一化）
    const pctCell = cell('changePercent');
    if (pctCell) {
      const pct = vm.changePercent;
      setText(pctCell, pct !== null ? `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%` : '--');
      pctCell.classList.toggle('is-up', pct !== null && pct > 0);
      pctCell.classList.toggle('is-down', pct !== null && pct < 0);
      pctCell.classList.toggle('is-limit', pct !== null && Math.abs(pct) >= LIMIT_PCT - 0.1);
      pctCell.style.setProperty(
        '--pct',
        pct === null ? '0' : Math.min(1, Math.abs(pct) / LIMIT_PCT).toFixed(3)
      );
    }

    setText(cell('amount'), vm.displayAmount);

    const menuBtn = tr.querySelector('button[data-action="stock-menu"]') as HTMLButtonElement | null;
    if (menuBtn) {
      // id 随行复用而变——虚拟窗口会把同一个 DOM 节点分配给不同股票。
      menuBtn.id = rowMenuId(vm.code);
      setAttr(menuBtn, 'aria-label', `打开 ${vm.name} 操作菜单`);
      // 置顶状态在行内仍需可感知（菜单未打开时）。
      menuBtn.classList.toggle('is-pinned', vm.pinned);
    }
  }
}
