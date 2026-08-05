// src/popup/components/app-popover-host.ts
// 非模态弹出层宿主：按锚点定位、Escape / 外部点击关闭、焦点归还。
//
// 与 app-dialog-host 的分工：对话框是模态的（阻断背景交互，用于创建/移动/删除
// 这类需要确认的操作）；popover 是轻量非模态的，用于「列设置」这类随手调整。
// 两者共用同一套焦点契约：打开时把焦点移入、关闭时还回触发元素。
//
// 架构约束：仅接收 ViewModel、发出语义事件；不访问 Store / RPC / Storage。
import type { PopoverViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';
import './column-panel.js';
import './stock-action-menu.js';
import type { ColumnPanelElement } from './column-panel.js';
import type { StockActionMenuElement } from './stock-action-menu.js';

/** 距视口边缘的最小留白（px），避免弹层被裁切。 */
const VIEWPORT_MARGIN = 8;

export class AppPopoverHostElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: PopoverViewModel | null = null;
  private panelEl: HTMLElement | null = null;
  private columnPanelEl: ColumnPanelElement | null = null;
  private actionMenuEl: StockActionMenuElement | null = null;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    const signal = this.connection.signal;

    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }

    // Escape 关闭——键盘用户必须能不依赖鼠标退出。
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this._viewModel?.open) {
        event.preventDefault();
        emitPopupEvent(this, 'popover-close-request', {});
      }
    }, { signal });

    // 外部点击关闭。用 pointerdown 而非 click：click 会在同一次交互中
    // 被触发按钮再次捕获，导致「打开即关闭」。
    document.addEventListener('pointerdown', (event: Event) => {
      if (!this._viewModel?.open) return;
      const target = event.target as Node | null;
      if (target && (this.contains(target) || this.isAnchor(target))) return;
      emitPopupEvent(this, 'popover-close-request', {});
    }, { signal });

    if (this._viewModel) this.applyViewModel(this._viewModel);
  }

  disconnectedCallback(): void {
    this.connection?.abort();
    this.connection = undefined;
  }

  get viewModel(): PopoverViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: PopoverViewModel) {
    const wasOpen = this._viewModel?.open ?? false;
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value, wasOpen);
  }

  /** 触发元素自身的点击不算「外部点击」，否则会打开即关闭。 */
  private isAnchor(target: Node): boolean {
    const anchorId = this._viewModel?.anchorId;
    if (!anchorId) return false;
    const anchor = document.getElementById(anchorId);
    return Boolean(anchor && (anchor === target || anchor.contains(target)));
  }

  private buildSkeleton(): void {
    const panel = document.createElement('div');
    panel.className = 'app-popover';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '列设置');
    panel.hidden = true;
    this.panelEl = panel;

    const columnPanel = document.createElement('column-panel') as ColumnPanelElement;
    columnPanel.hidden = true;
    this.columnPanelEl = columnPanel;
    panel.append(columnPanel);

    const actionMenu = document.createElement('stock-action-menu') as StockActionMenuElement;
    actionMenu.hidden = true;
    this.actionMenuEl = actionMenu;
    panel.append(actionMenu);

    this.append(panel);
  }

  private applyViewModel(vm: PopoverViewModel, wasOpen = false): void {
    const panel = this.panelEl;
    if (!panel) return;

    if (!vm.open) {
      panel.hidden = true;
      // 关闭态的 VM 不带 anchorId，必须用打开时记下的那个——
      // 否则触发按钮的 aria-expanded 会永远停在 true。
      const lastAnchor = this.getAttribute('data-last-anchor');
      this.setAnchorExpanded(lastAnchor, false);
      // 关闭时把焦点还回触发元素——否则焦点会掉到 body，键盘用户丢失位置。
      if (wasOpen) this.restoreFocus();
      return;
    }

    panel.hidden = false;

    // 按 kind 切换内容，并同步 aria-label——两种弹层用同一个 role="dialog"
    // 容器，标签不切换的话屏幕阅读器会把操作菜单读成「列设置」。
    const isColumns = vm.kind === 'column-settings';
    if (this.columnPanelEl) {
      this.columnPanelEl.hidden = !isColumns;
      if (isColumns && vm.columnPanel) this.columnPanelEl.viewModel = vm.columnPanel;
    }
    if (this.actionMenuEl) {
      this.actionMenuEl.hidden = isColumns;
      if (!isColumns && vm.stockActions) this.actionMenuEl.viewModel = vm.stockActions;
    }
    panel.setAttribute(
      'aria-label',
      isColumns ? '列设置' : `${vm.stockActions?.name ?? ''} 操作菜单`.trim()
    );

    this.position(vm.anchorId);
    this.setAnchorExpanded(vm.anchorId, true);

    if (!wasOpen) {
      // 打开时把焦点移入第一个可交互控件。
      const first = panel.querySelector<HTMLElement>(
        'input, button, [tabindex]:not([tabindex="-1"])'
      );
      first?.focus?.();
    }
  }

  private setAnchorExpanded(anchorId: string | null, expanded: boolean): void {
    if (!anchorId) return;
    document.getElementById(anchorId)?.setAttribute('aria-expanded', String(expanded));
  }

  private restoreFocus(): void {
    const anchorId = this._viewModel?.anchorId ?? this.getAttribute('data-last-anchor');
    if (anchorId) document.getElementById(anchorId)?.focus?.();
  }

  /** 依锚点矩形定位，并夹在视口内（Popup 只有 420×560，很容易溢出）。 */
  private position(anchorId: string | null): void {
    const panel = this.panelEl;
    if (!panel || !anchorId) return;
    const anchor = document.getElementById(anchorId);
    if (!anchor?.getBoundingClientRect) return;
    this.setAttribute('data-last-anchor', anchorId);

    const rect = anchor.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top = `${rect.bottom + 4}px`;

    const width = panel.offsetWidth || 200;
    const viewportWidth = document.documentElement.clientWidth || 420;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.left),
      Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN)
    );
    panel.style.left = `${left}px`;
  }
}
