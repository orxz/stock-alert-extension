import type { PopoverViewModel } from '../view-models.js';
import type { ColumnPanelElement } from './column-panel.js';
import type { StockActionMenuElement } from './stock-action-menu.js';
import { emitPopupEvent } from './events.js';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;
const FALLBACK_WIDTH = 224;
const FALLBACK_HEIGHT = 240;

/** 统一 fixed 弹层宿主：负责选择内容、定位、关闭手势与焦点返回。 */
export class AppPopoverHostElement extends HTMLElement {
  private connection: AbortController | undefined;
  private _viewModel: PopoverViewModel | null = null;
  private lastAnchorId: string | null = null;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    const signal = this.connection.signal;
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.isOpen()) return;
      event.preventDefault();
      this.requestClose('escape');
    }, { signal });
    document.addEventListener('pointerdown', (event) => {
      if (!this.isOpen()) return;
      const target = event.target as Node | null;
      const anchor = this.currentAnchor();
      if ((target && this.contains(target)) || (target && anchor?.contains(target))) return;
      this.requestClose('outside');
    }, { capture: true, signal });
    this.render();
  }

  disconnectedCallback(): void {
    this.connection?.abort();
    this.connection = undefined;
  }

  get viewModel(): PopoverViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: PopoverViewModel) {
    const wasOpen = this.isOpen();
    this._viewModel = value;
    if (value.open && value.anchorId) this.lastAnchorId = value.anchorId;
    if (this.isConnected) {
      this.render();
      if (wasOpen && !value.open) this.restoreAnchorFocus();
    }
  }

  private isOpen(): boolean {
    return Boolean(this._viewModel?.open && !this.hidden);
  }

  private currentAnchor(): HTMLElement | null {
    const id = this._viewModel?.anchorId ?? this.lastAnchorId;
    return id ? document.getElementById(id) : null;
  }

  private requestClose(reason: 'escape' | 'outside' | 'missing-anchor'): void {
    emitPopupEvent(this, 'popover-close-request', { reason });
    this.restoreAnchorFocus();
  }

  private restoreAnchorFocus(): void {
    const id = this.lastAnchorId;
    if (id) document.getElementById(id)?.focus();
  }

  private render(): void {
    this.textContent = '';
    const vm = this._viewModel;
    if (!vm?.open || !vm.kind || !vm.anchorId) {
      this.hidden = true;
      this.setAttribute('aria-hidden', 'true');
      return;
    }

    const anchor = document.getElementById(vm.anchorId);
    if (!anchor) {
      this.hidden = true;
      this.setAttribute('aria-hidden', 'true');
      this.requestClose('missing-anchor');
      return;
    }

    if (vm.kind === 'stock-actions') {
      if (!vm.stock) {
        this.hidden = true;
        this.setAttribute('aria-hidden', 'true');
        return;
      }
      const menu = document.createElement('stock-action-menu') as StockActionMenuElement;
      menu.viewModel = vm;
      this.append(menu);
    } else {
      const panel = document.createElement('column-panel') as ColumnPanelElement;
      panel.viewModel = vm.columnPanel;
      this.append(panel);
    }

    this.hidden = false;
    this.setAttribute('aria-hidden', 'false');
    this.style.position = 'fixed';
    this.style.zIndex = '1000';
    this.positionFrom(anchor);
    const firstControl = this.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled])'
    );
    firstControl?.focus();
  }

  private positionFrom(anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = this.getBoundingClientRect();
    const width = popoverRect.width || FALLBACK_WIDTH;
    const height = popoverRect.height || FALLBACK_HEIGHT;
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    const left = Math.min(Math.max(anchorRect.left, VIEWPORT_MARGIN), maxLeft);
    const top = Math.min(Math.max(anchorRect.bottom + ANCHOR_GAP, VIEWPORT_MARGIN), maxTop);
    this.style.left = `${left}px`;
    this.style.top = `${top}px`;
  }
}
