// src/popup/components/stock-table.ts
// Task 16 Step 4 — 列表视图组件。
// Real table/thead/tbody + header 按钮 + aria-sort。行 keyed by stock code。
// 行内 pin/up/down 按钮复用 moveKey helper，与 stock-card 行为一致。
// 架构约束：仅 import domain + view-models + events + keyed-update；per-connection AbortController。
import type { StockCode, GroupId, SortField, SortDirection } from '../../domain/index.js';
import type { StockCardViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';
import { applyTooltipFlip } from './detail-tooltip.js';
import { moveKey } from './stock-card.js';
import { updateKeyedChildren } from './keyed-update.js';
import { calculateVirtualWindow } from '../virtualization/virtual-window.js';
import type { VirtualViewport } from '../virtualization/virtual-window.js';

/**
 * 单行高度（px）——必须与 tokens.css 的 --row-h（.stock-table-row 行高）一致。
 * 导出供测试引用：此前测试各自硬编码 48，CSS 改成 40px 时没有任何断言拦住，
 * spacer 高度与真实行高错位了整整 8px/行。
 */
export const TABLE_ROW_EXTENT = 40;
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

/**
 * 主列 key 的固定全集——列设置面板里可重排的全部主列。
 * order 必须始终是它的完整排列：列数恒定，spacer 的 colSpan 才不会错位。
 */
const MAIN_COLUMNS: readonly string[] = COLUMNS.map((c) => c.key);

/** 默认主列顺序（与 COLUMNS 定义一致）。 */
const DEFAULT_COLUMN_ORDER: readonly string[] = [...MAIN_COLUMNS];

/**
 * 规范化列顺序：去重、只保留已知主列、补齐缺失的主列。
 * 列设置面板的 order 可能包含 code/status 副标题键——它们不是独立列，过滤掉。
 */
function normalizeColumnOrder(value: readonly string[] | undefined): readonly string[] {
  const seen: string[] = [];
  for (const key of value ?? []) {
    if ((MAIN_COLUMNS as readonly string[]).includes(key) && !seen.includes(key)) seen.push(key);
  }
  for (const key of MAIN_COLUMNS) {
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

/** 两个顺序数组是否逐项相等。 */
function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

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
  /** 主列显示顺序（由列设置面板重排）。默认 name→price→changePercent→amount。 */
  private _columnOrder: readonly string[] = DEFAULT_COLUMN_ORDER;
  private _selectedCodes: readonly StockCode[] = [];
  private _selectionMode = false;
  /** 选中集的 Set 视图：逐行 includes() 在 500 行列表上是 O(n·m)。 */
  private _selectedSet: ReadonlySet<StockCode> = new Set();

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

  get columnOrder(): readonly string[] {
    return this._columnOrder;
  }

  /**
   * 设置主列显示顺序。顺序变化需要重建 colgroup/thead 并重挂数据行——
   * 列重排是低频用户操作，重建代价可接受；行内 updateRow 按 data-column
   * 取单元格，不依赖下标，重建后数据映射不会错位。
   */
  set columnOrder(value: readonly string[] | undefined) {
    const next = normalizeColumnOrder(value);
    if (sameOrder(next, this._columnOrder)) return;
    this._columnOrder = next;
    if (this.isConnected) this.rebuildHeader();
  }

  get selectedCodes(): readonly StockCode[] {
    return this._selectedCodes;
  }

  set selectedCodes(value: readonly StockCode[]) {
    // selectBatchToolbar 原样返回 state.view.selectedCodes，未 dispatch view/selection
    // 时引用不变——不挡住的话，每次 store 变更都要多跑一次整表 render。
    if (value === this._selectedCodes) return;
    this._selectedCodes = value;
    this._selectedSet = new Set(value);
    if (this.isConnected) this.render();
  }

  get selectionMode(): boolean {
    return this._selectionMode;
  }

  set selectionMode(value: boolean) {
    if (value === this._selectionMode) return;
    this._selectionMode = value;
    if (this.isConnected) this.render();
  }

  /** 选择列的显隐——只在持仓管理模式下占位，平时不挤压数据列宽。 */
  private applySelectionColumn(): void {
    if (!this.table) return;
    const th = this.table.querySelector('thead th[data-column="select"]');
    if (th) (th as HTMLElement).hidden = !this._selectionMode;
    for (const td of this.querySelectorAll<HTMLElement>('tbody [data-column="select"]')) {
      td.hidden = !this._selectionMode;
    }
    this.setColumnWidth('select', this._selectionMode);
  }

  /** 把某列的 <col> 归零/恢复——隐藏的列必须真正让出宽度。 */
  private setColumnWidth(key: string, visible: boolean): void {
    const col = this.table?.querySelector(`col[data-col="${key}"]`) as HTMLElement | null;
    col?.toggleAttribute('data-off', !visible);
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
      // 同时把该列的 <col> 归零，否则关掉的列仍以 auto 身份参与剩余宽度平分。
      this.setColumnWidth(col.key, visible);
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

    // 列宽必须由 <colgroup> 控制，不能只靠单元格上的 width。
    // table-layout:fixed 会把剩余宽度平分给所有「未指定宽度」的列，而
    // display:none 的单元格并不向该列贡献宽度——于是被隐藏的列（选择列、
    // 或被列设置关掉的成交额）反而变成 auto 列，和名称列对半分掉剩余空间，
    // 名称被挤没、右侧留下一大片空白。<col data-off> 把它归零才真正消失。
    // 列内容（col 元素 + 表头）由 rebuildHeader 按当前 columnOrder 填充。
    const colgroup = document.createElement('colgroup');
    table.append(colgroup);

    const thead = document.createElement('thead');
    table.append(thead);

    const tbody = document.createElement('tbody');
    this.tbody = tbody;

    // 上下 spacer：撑出未渲染行占据的高度，让滚动条长度与完整列表一致。
    // 对辅助技术隐藏——它们不是数据行。
    // COLUMNS + 选择列 + 操作列。
    const columnCount = COLUMNS.length + 2;
    this.topSpacer = createSpacerRow(columnCount);
    this.bottomSpacer = createSpacerRow(columnCount);
    tbody.append(this.topSpacer, this.bottomSpacer);

    table.append(tbody);
    this.table = table;
    this.append(table);

    // 列结构（colgroup + thead）按当前 columnOrder 填充。
    this.rebuildHeader();
  }

  /**
   * 按当前 columnOrder 重建 colgroup + thead，并清空 tbody 数据行。
   * 列重排 / 首次构建共用；事件走 this 上的委托，表头重建不影响监听。
   */
  private rebuildHeader(): void {
    if (!this.table) return;

    const colgroup = this.table.querySelector('colgroup');
    if (colgroup) {
      colgroup.textContent = '';
      for (const key of ['select', ...this._columnOrder, 'actions']) {
        const col = document.createElement('col');
        col.setAttribute('data-col', key);
        colgroup.append(col);
      }
    }

    const thead = this.table.querySelector('thead');
    if (thead) {
      thead.textContent = '';
      const headerRow = document.createElement('tr');

      // 选择列：常驻 head（列数恒定），靠 hidden 切换。
      const selectTh = document.createElement('th');
      selectTh.setAttribute('data-column', 'select');
      selectTh.className = 'stock-table-cell--select';
      const selectThLabel = document.createElement('span');
      selectThLabel.className = 'visually-hidden';
      selectThLabel.textContent = '选择';
      selectTh.append(selectThLabel);
      selectTh.hidden = !this._selectionMode;
      headerRow.append(selectTh);

      // 主列按用户设置的顺序排布。
      for (const key of this._columnOrder) {
        const col = COLUMNS.find((c) => c.key === key);
        if (!col) continue;
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

      // 操作列（无排序）。
      const actionsTh = document.createElement('th');
      actionsTh.textContent = '操作';
      headerRow.append(actionsTh);

      thead.append(headerRow);
    }

    // 顺序变化后已有数据行的 td 排列已过期——清掉让 render 按新顺序重建。
    if (this.tbody) {
      for (const tr of this.tbody.querySelectorAll('tr[data-key]')) tr.remove();
    }

    this.updateSortIndicators();
    this.applyColumnVisibility();
    this.applySelectionColumn();
    this.render();
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

      // 复选框：点击即切换选中。原生 checkbox 自己会翻转 checked，
      // 这里只负责把意图广播出去，真正的状态仍然由 store 回流决定。
      if (target.closest('.stock-table-select-box')) {
        emitPopupEvent(this, 'stock-toggle-select', { code });
        return;
      }

      // 持仓管理模式下点击行的空白处也切换选中——只有复选框那 30px 可点，
      // 在 420px 面板里太苛刻。按钮区域除外（那是别的动作）。
      if (this._selectionMode && !target.closest('button')) {
        emitPopupEvent(this, 'stock-toggle-select', { code });
        return;
      }

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

    // 悬停详情浮层翻转：行位于滚动容器可视区底部附近时向上展开，避免被裁剪。
    // mouseover 冒泡可委托；同行的重复触发用 lastHoveredRow 缓存短路。
    this.addEventListener('mouseover', (e) => {
      const row = (e.target as HTMLElement).closest('tr[data-key]') as HTMLElement | null;
      if (row) this.refreshTooltipFlip(row);
    }, { signal });
    this.addEventListener('mouseleave', () => {
      this.clearTooltipFlip();
    }, { signal });
    // 键盘可达性：focus-within 同样触发浮层，底部行聚焦时也要翻转。
    this.addEventListener('focusin', (e) => {
      const row = (e.target as HTMLElement).closest('tr[data-key]') as HTMLElement | null;
      if (row) this.refreshTooltipFlip(row);
    }, { signal });
    this.addEventListener('focusout', () => {
      this.clearTooltipFlip();
    }, { signal });
  }

  /** 上次触发翻转检测的行——mouseover 在行内子元素间高频触发，同一行只算一次。 */
  private lastHoveredRow: HTMLElement | null = null;

  private refreshTooltipFlip(row: HTMLElement): void {
    if (this.lastHoveredRow === row) return;
    this.lastHoveredRow = row;
    const scroller = this.closest('stock-board') as HTMLElement | null;
    if (scroller) applyTooltipFlip(row, scroller);
  }

  /** 离开行/失焦时清理：翻转状态是悬停期装饰，行复用给其他股票前必须复位。 */
  private clearTooltipFlip(): void {
    this.lastHoveredRow = null;
    for (const tooltip of this.querySelectorAll('.stock-detail-tooltip.is-flipped')) {
      tooltip.classList.remove('is-flipped');
    }
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
    this.applySelectionColumn();
  }

  private createRow(vm: StockCardViewModel): HTMLElement {
    const tr = document.createElement('tr');
    tr.className = 'stock-table-row';

    // 选择复选框列。原生 checkbox 而不是「点整行 + data-selected」：
    // 选中状态因此天然进入无障碍树（checked），键盘可达、可 Space 切换，
    // 而 aria-selected 在 role=row 上根本不合法（表格不是 grid）。
    const selectTd = document.createElement('td');
    selectTd.className = 'stock-table-cell stock-table-cell--select';
    selectTd.setAttribute('data-column', 'select');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'stock-table-select-box';
    checkbox.setAttribute('data-action', 'toggle-select');
    selectTd.append(checkbox);
    selectTd.hidden = !this._selectionMode;
    tr.append(selectTd);

    // 主列按用户设置的顺序排列（code/status 仍是名称列下的副标题）。
    for (const key of this._columnOrder) {
      tr.append(this.createColumnTd(key));
    }

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

    tr.append(actionsTd);

    this.updateRow(tr, vm);
    return tr;
  }

  /** 按主列 key 创建数据单元格（列结构固定，data-column 是 updateRow 的稳定锚点）。 */
  private createColumnTd(key: string): HTMLElement {
    switch (key) {
      case 'name': {
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
        // flex 包装层：td 必须保持 display:table-cell（table-layout:fixed 靠它对齐列宽），
        // 所以截断只能发生在内部包装层上——让名称独自收缩省略，
        // 代码/状态不参与收缩，否则整格 ellipsis 会去切最后一项（「实时」→「实」）。
        const nameWrap = document.createElement('span');
        nameWrap.className = 'stock-table-name-wrap';
        nameWrap.append(nameSpan, subline);
        nameTd.append(nameWrap, this.createDetailTooltip());
        return nameTd;
      }
      case 'price': {
        const priceTd = document.createElement('td');
        priceTd.className = 'stock-table-cell stock-table-cell--price';
        priceTd.setAttribute('data-column', 'price');
        priceTd.setAttribute('data-field', 'price');
        return priceTd;
      }
      case 'changePercent': {
        const pctTd = document.createElement('td');
        pctTd.className = 'stock-table-cell stock-table-cell--change-percent';
        pctTd.setAttribute('data-column', 'changePercent');
        return pctTd;
      }
      case 'amount': {
        const amountTd = document.createElement('td');
        amountTd.className = 'stock-table-cell stock-table-cell--amount';
        amountTd.setAttribute('data-column', 'amount');
        return amountTd;
      }
      default:
        return document.createElement('td');
    }
  }

  /** 悬停详情面板骨架：挂在名称格下，hover 时由 CSS 浮出（role=tooltip）。 */
  private createDetailTooltip(): HTMLElement {
    const tooltip = document.createElement('div');
    tooltip.className = 'stock-detail-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    const fields: ReadonlyArray<readonly [string, string]> = [
      ['今开', 'open'],
      ['最高', 'high'],
      ['最低', 'low'],
      ['昨收', 'prevClose'],
      ['成交量', 'volume'],
      ['成交额', 'amount'],
      ['涨跌额', 'change'],
      ['换手率', 'turnoverRate'],
      ['振幅', 'amplitude'],
      ['量比', 'volumeRatio'],
      ['市盈率', 'pe'],
      ['市净率', 'pb'],
      ['总市值', 'totalMarketCap'],
      ['流通市值', 'floatMarketCap'],
      ['涨停', 'limitUp'],
      ['跌停', 'limitDown']
    ];
    for (const [label, key] of fields) {
      const item = document.createElement('div');
      item.className = 'stock-detail-item';
      const labelEl = document.createElement('span');
      labelEl.className = 'stock-detail-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'stock-detail-value';
      valueEl.setAttribute('data-field', key);
      item.append(labelEl, valueEl);
      tooltip.append(item);
    }
    return tooltip;
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
      // 现价跟随涨跌染色——与卡片、涨跌幅列一致。
      priceCell.classList.toggle('is-up', vm.change !== null && vm.change > 0);
      priceCell.classList.toggle('is-down', vm.change !== null && vm.change < 0);
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

    // 悬停详情：16 个可读字段，文本由 view-model 保证（缺失 '--' / 掩码 '****'）。
    const detailValue = (key: string): string => {
      switch (key) {
        case 'open': return vm.displayOpen;
        case 'high': return vm.displayHigh;
        case 'low': return vm.displayLow;
        case 'prevClose': return vm.displayPrevClose;
        case 'volume': return vm.displayVolume;
        case 'amount': return vm.displayAmount;
        case 'change': return vm.displayChange;
        case 'turnoverRate': return vm.displayTurnoverRate;
        case 'amplitude': return vm.displayAmplitude;
        case 'volumeRatio': return vm.displayVolumeRatio;
        case 'pe': return vm.displayPe;
        case 'pb': return vm.displayPb;
        case 'totalMarketCap': return vm.displayTotalMarketCap;
        case 'floatMarketCap': return vm.displayFloatMarketCap;
        case 'limitUp': return vm.displayLimitUp;
        case 'limitDown': return vm.displayLimitDown;
        default: return '';
      }
    };
    for (const key of ['open', 'high', 'low', 'prevClose', 'volume', 'amount', 'change', 'turnoverRate', 'amplitude', 'volumeRatio', 'pe', 'pb', 'totalMarketCap', 'floatMarketCap', 'limitUp', 'limitDown']) {
      setText(tr.querySelector(`.stock-detail-value[data-field="${key}"]`), detailValue(key));
    }

    const menuBtn = tr.querySelector('button[data-action="stock-menu"]') as HTMLButtonElement | null;
    if (menuBtn) {
      // id 随行复用而变——虚拟窗口会把同一个 DOM 节点分配给不同股票。
      menuBtn.id = rowMenuId(vm.code);
      setAttr(menuBtn, 'aria-label', `打开 ${vm.name} 操作菜单`);
      // 置顶状态在行内仍需可感知（菜单未打开时）。
      menuBtn.classList.toggle('is-pinned', vm.pinned);
    }

    // 选中态：视觉走 data-selected，语义走 checkbox 的 checked
    // （aria-selected 在 role=row 上不合法，checked 才是这里唯一正确的通道）。
    const selected = this._selectedSet.has(vm.code);
    tr.toggleAttribute('data-selected', selected);
    const box = tr.querySelector('.stock-table-select-box') as HTMLInputElement | null;
    if (box) {
      box.checked = selected;
      box.setAttribute('aria-label', `选择 ${vm.name}`);
    }
  }
}
