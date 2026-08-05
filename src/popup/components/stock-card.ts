// src/popup/components/stock-card.ts
// Task 16 Step 4 — 安全的股票卡片渲染组件。
// article + text nodes + native buttons；价格掩码改变文本为 **** 但保留 accessible name。
// fresh/cached/missing 有文本标签；无 innerHTML。
// Pin 按钮发出 stock-pin-request；up/down 按钮通过 moveKey helper 计算完整 orderedCodes 并发出 stock-order-request。
// 架构约束：仅 import domain + view-models + events；per-connection AbortController。
import type { StockCode, GroupId } from '../../domain/brands.js';
import type { StockCardViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';

/**
 * 纯函数：在有序代码列表中将 code 移动 delta 位，返回新数组。
 * 指针拖拽和键盘 up/down 按钮共用此 helper。
 */
/**
 * 卡片操作触发器的确定性 id——popover 用它定位并在关闭时归还焦点。
 * 必须稳定：虚拟窗口滚动时卡片节点会被复用给不同股票。
 */
export function cardMenuId(code: string): string {
  return `stock-actions-${code}`;
}

export function moveKey(
  orderedCodes: readonly StockCode[],
  code: StockCode,
  delta: number
): StockCode[] {
  const result = [...orderedCodes];
  const i = result.indexOf(code);
  if (i < 0) return result;
  const j = i + delta;
  if (j < 0 || j >= result.length) return result;
  [result[i], result[j]] = [result[j], result[i]];
  return result;
}

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

  private nameEl: HTMLElement | null = null;
  private priceEl: HTMLElement | null = null;
  private changeEl: HTMLElement | null = null;
  private changePercentEl: HTMLElement | null = null;
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

  private buildSkeleton(): void {
    // 卡片可聚焦（tabindex=0）+ Enter/Space 切换 pin；容器用 role=group 而非
    // role=button，避免 axe nested-interactive（group 是容器角色，允许内部按钮）。
    this.setAttribute('tabindex', '0');
    this.setAttribute('role', 'group');

    const article = document.createElement('article');
    article.className = 'stock-card';

    // Name + code row
    const headerDiv = document.createElement('div');
    headerDiv.className = 'stock-card-header';
    const nameEl = document.createElement('span');
    nameEl.className = 'stock-card-name';
    nameEl.setAttribute('data-field', 'name');
    this.nameEl = nameEl;
    headerDiv.append(nameEl);

    // Price area
    const priceDiv = document.createElement('div');
    priceDiv.className = 'stock-card-price-area';
    const priceEl = document.createElement('span');
    priceEl.className = 'stock-card-price';
    priceEl.setAttribute('data-field', 'price');
    this.priceEl = priceEl;
    const changeEl = document.createElement('span');
    changeEl.className = 'stock-card-change';
    this.changeEl = changeEl;
    const changePercentEl = document.createElement('span');
    changePercentEl.className = 'stock-card-change-percent';
    this.changePercentEl = changePercentEl;
    priceDiv.append(priceEl, changeEl, changePercentEl);

    // Status + stale
    const statusDiv = document.createElement('div');
    statusDiv.className = 'stock-card-status';
    const statusEl = document.createElement('span');
    statusEl.className = 'stock-card-status-label';
    this.statusEl = statusEl;
    const staleEl = document.createElement('span');
    staleEl.className = 'stock-card-stale';
    this.staleEl = staleEl;
    statusDiv.append(statusEl, staleEl);

    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'stock-card-actions';

    // 单一 ••• 触发器取代 置顶/↑/↓ 三连按钮——具体动作交给 stock-action-menu。
    // 卡片本身的 Enter/Space 仍直接切换置顶（高频动作保留快捷路径）。
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'stock-card-btn stock-card-action stock-row-menu-trigger';
    menuBtn.setAttribute('data-action', 'stock-menu');
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.textContent = '•••';
    this.menuBtn = menuBtn;

    actionsDiv.append(menuBtn);

    article.append(headerDiv, priceDiv, statusDiv, actionsDiv);
    this.append(article);
  }

  /** 切换置顶（Enter/Space 快捷键与菜单共用同一语义）。 */
  private togglePin(): void {
    if (!this._viewModel) return;
    const newPinned = !this._viewModel.pinned;
    // 置顶把自己提到最前；取消置顶保持当前顺序。
    const orderedCodes = newPinned
      ? [this._viewModel.code, ...this._orderedCodes.filter((c) => c !== this._viewModel!.code)]
      : [...this._orderedCodes];
    emitPopupEvent(this, 'stock-pin-request', {
      code: this._viewModel.code,
      pinned: newPinned,
      orderedCodes
    });
  }

  private bindEvents(signal: AbortSignal): void {
    this.menuBtn?.addEventListener('click', () => {
      if (!this._viewModel) return;
      emitPopupEvent(this, 'stock-menu-open-request', {
        anchorId: cardMenuId(this._viewModel.code),
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

    // 键盘快捷键：Enter/Space 切换 pin（卡片可聚焦，role=group 不构成嵌套交互）。
    this.addEventListener('keydown', (e) => {
      if (!this._viewModel) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.togglePin();
      }
    }, { signal });
  }

  private applyViewModel(vm: StockCardViewModel): void {
    this.setAttribute('data-key', vm.code);
    const article = this.querySelector('article');
    if (article) {
      article.setAttribute(
        'aria-label',
        `${vm.name} ${vm.displayPrice}${vm.pinned ? ' 已置顶' : ''}`
      );
    }

    if (this.nameEl) {
      this.nameEl.textContent = vm.name;
    }
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
    if (this.statusEl) {
      this.statusEl.textContent = STATUS_LABELS[vm.status] ?? '';
    }
    if (this.staleEl) {
      this.staleEl.textContent = vm.staleLabel;
      this.staleEl.classList.toggle('stock-card-stale', Boolean(vm.staleLabel));
      this.staleEl.toggleAttribute('data-stale', Boolean(vm.staleLabel));
    }
    if (this.menuBtn) {
      this.menuBtn.id = cardMenuId(vm.code);
      this.menuBtn.setAttribute('aria-label', `打开 ${vm.name} 操作菜单`);
      // 置顶状态在菜单未打开时仍需可感知。
      this.menuBtn.classList.toggle('is-pinned', vm.pinned);
    }
    // 置顶状态进入可访问名称，而不是 aria-pressed——卡片在网格里的 role 是
    // listitem，aria-pressed 只允许用在 button 类角色上（axe: aria-allowed-attr）。
    this.setAttribute('data-pinned', String(vm.pinned));
  }
}
