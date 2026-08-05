// src/popup/components/stock-card.ts
// Task 16 Step 4 — 安全的股票卡片渲染组件。
// article + text nodes + native buttons；价格掩码改变文本为 **** 但保留 accessible name。
// fresh/cached/missing 有文本标签；无 innerHTML。
// 每张卡片仅保留一个确定性菜单触发器；具体操作由统一 popover 承载。
// 架构约束：仅 import domain + view-models + events；per-connection AbortController。
import type { StockCode, GroupId } from '../../domain/brands.js';
import type { StockCardViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';
import { DEFAULT_UI_COLUMNS, normalizeUiColumns, type ColumnKey, type UiColumnPreferences } from '../ui-preferences.js';

const STATUS_LABELS: Readonly<Record<StockCardViewModel['status'], string>> = {
  fresh: '实时',
  cached: '缓存',
  missing: '缺失'
};

export class StockCardElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: StockCardViewModel | null = null;
  private _orderedCodes: readonly StockCode[] = [];
  private _groupId: GroupId = 'g_all' as GroupId;
  private _columns: UiColumnPreferences = DEFAULT_UI_COLUMNS;

  private fieldsEl: HTMLElement | null = null;
  private columnElements = new Map<ColumnKey, HTMLElement>();
  private nameEl: HTMLElement | null = null;
  private codeEl: HTMLElement | null = null;
  private priceEl: HTMLElement | null = null;
  private changeEl: HTMLElement | null = null;
  private changePercentEl: HTMLElement | null = null;
  private amountEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private staleEl: HTMLElement | null = null;
  private menuBtn: HTMLButtonElement | null = null;

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

  get viewModel(): StockCardViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: StockCardViewModel) {
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value);
  }

  get orderedCodes(): readonly StockCode[] {
    return this._orderedCodes;
  }

  set orderedCodes(value: readonly StockCode[]) {
    this._orderedCodes = value;
  }

  get groupId(): GroupId {
    return this._groupId;
  }

  set groupId(value: GroupId) {
    this._groupId = value;
  }

  get columns(): UiColumnPreferences {
    return this._columns;
  }

  set columns(value: UiColumnPreferences) {
    this._columns = normalizeUiColumns(value);
    if (this.isConnected) this.applyColumnPreferences();
  }

  private buildSkeleton(): void {
    // 卡片可聚焦（tabindex=0）+ Enter/Space 打开菜单；在 stock-grid 的
    // role=list 容器中作为 listitem，同时允许内部原生菜单触发按钮。
    this.setAttribute('tabindex', '0');
    this.setAttribute('role', 'listitem');

    const article = document.createElement('article');
    article.className = 'stock-card';
    article.style.height = '100%';

    const fields = document.createElement('div');
    fields.className = 'stock-card-fields';
    this.fieldsEl = fields;

    const nameEl = document.createElement('span');
    nameEl.className = 'stock-card-name';
    nameEl.setAttribute('data-column', 'name');
    this.nameEl = nameEl;

    const codeEl = document.createElement('span');
    codeEl.className = 'stock-card-code stock-card-secondary';
    codeEl.setAttribute('data-column', 'code');
    this.codeEl = codeEl;

    // Price area
    const priceDiv = document.createElement('div');
    priceDiv.className = 'stock-card-price-area';
    priceDiv.setAttribute('data-column', 'price');
    const priceEl = document.createElement('span');
    priceEl.className = 'stock-card-price';
    this.priceEl = priceEl;
    const changeEl = document.createElement('span');
    changeEl.className = 'stock-card-change';
    this.changeEl = changeEl;
    const changePercentEl = document.createElement('span');
    changePercentEl.className = 'stock-card-change-percent';
    changePercentEl.setAttribute('data-column', 'changePercent');
    this.changePercentEl = changePercentEl;
    priceDiv.append(priceEl, changeEl);

    const amountEl = document.createElement('span');
    amountEl.className = 'stock-card-amount';
    amountEl.setAttribute('data-column', 'amount');
    this.amountEl = amountEl;

    // Status + stale
    const statusDiv = document.createElement('div');
    statusDiv.className = 'stock-card-status stock-card-secondary';
    statusDiv.setAttribute('data-column', 'status');
    const statusEl = document.createElement('span');
    statusEl.className = 'stock-card-status-label';
    this.statusEl = statusEl;
    const staleEl = document.createElement('span');
    staleEl.className = 'stock-card-stale';
    this.staleEl = staleEl;
    statusDiv.append(statusEl, staleEl);

    this.columnElements = new Map<ColumnKey, HTMLElement>([
      ['name', nameEl],
      ['code', codeEl],
      ['price', priceDiv],
      ['changePercent', changePercentEl],
      ['amount', amountEl],
      ['status', statusDiv]
    ]);
    this.applyColumnPreferences();

    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'stock-card-actions';

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'stock-card-btn stock-card-action';
    menuBtn.dataset.action = 'stock-menu';
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.textContent = '•••';
    this.menuBtn = menuBtn;

    actionsDiv.append(menuBtn);

    article.append(fields, actionsDiv);
    this.append(article);
  }

  private bindEvents(signal: AbortSignal): void {
    this.menuBtn?.addEventListener('click', () => {
      if (!this._viewModel) return;
      emitPopupEvent(this, 'stock-menu-open-request', {
        anchorId: `stock-actions-${this._viewModel.code}`,
        code: this._viewModel.code
      });
    }, { signal });

    // 卡片点击：发出 stock-toggle-select（app-shell 在选择模式下处理）。
    this.addEventListener('click', (e) => {
      if (!this._viewModel) return;
      // 忽略来自按钮的点击。
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      emitPopupEvent(this, 'stock-toggle-select', { code: this._viewModel.code });
    }, { signal });

    // 键盘快捷键：卡片自身聚焦时 Enter/Space 打开操作菜单。
    this.addEventListener('keydown', (e) => {
      if (!this._viewModel) return;
      if ((e.target as HTMLElement).closest('button')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.menuBtn?.click();
      }
    }, { signal });
  }

  private applyViewModel(vm: StockCardViewModel): void {
    this.setAttribute('data-key', vm.code);
    const article = this.querySelector('article');
    if (article) {
      article.setAttribute('aria-label', `${vm.name} ${vm.displayPrice}`);
    }

    if (this.nameEl) {
      this.nameEl.textContent = vm.name;
    }
    if (this.codeEl) this.codeEl.textContent = vm.code;
    if (this.priceEl) {
      const old = this.priceEl.textContent;
      this.priceEl.textContent = vm.displayPrice;
      if (old !== vm.displayPrice && vm.displayPrice !== '--') {
        this.priceEl.classList.add('flash');
        setTimeout(() => this.priceEl?.classList.remove('flash'), 250);
      }
    }
    if (this.changeEl) {
      const changeText = vm.change !== null ? vm.change.toFixed(2) : '--';
      this.changeEl.textContent = changeText;
      this.changeEl.classList.toggle('is-up', vm.change !== null && vm.change > 0);
      this.changeEl.classList.toggle('is-down', vm.change !== null && vm.change < 0);
    }
    if (this.changePercentEl) {
      const pctText = vm.changePercent !== null ? `${vm.changePercent.toFixed(2)}%` : '--';
      this.changePercentEl.textContent = pctText;
      this.changePercentEl.classList.toggle('is-up', vm.changePercent !== null && vm.changePercent > 0);
      this.changePercentEl.classList.toggle('is-down', vm.changePercent !== null && vm.changePercent < 0);
    }
    if (this.amountEl) this.amountEl.textContent = vm.displayAmount;
    if (this.statusEl) {
      this.statusEl.textContent = STATUS_LABELS[vm.status] ?? '';
    }
    if (this.staleEl) {
      this.staleEl.textContent = vm.staleLabel;
      this.staleEl.classList.toggle('stock-card-stale', Boolean(vm.staleLabel));
    }
    if (this.menuBtn) {
      this.menuBtn.id = `stock-actions-${vm.code}`;
      this.menuBtn.setAttribute('aria-label', `打开 ${vm.name} 操作菜单`);
    }
  }

  private applyColumnPreferences(): void {
    if (!this.fieldsEl) return;
    const enabled = new Set(this._columns.enabled);
    for (const key of this._columns.order) {
      const element = this.columnElements.get(key);
      if (!element) continue;
      if (enabled.has(key)) this.fieldsEl.append(element);
      else element.remove();
    }
  }
}
