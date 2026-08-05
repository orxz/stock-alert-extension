import type { PopoverViewModel } from '../view-models.js';
import type { ColumnPanelElement } from './column-panel.js';
import type { StockActionMenuElement } from './stock-action-menu.js';
import { emitPopupEvent } from './events.js';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;
const FALLBACK_WIDTH = 224;
const FALLBACK_HEIGHT = 240;

type FocusedControl =
  | { type: 'stock-action'; action: string }
  | { type: 'column-toggle'; column: string }
  | { type: 'column-action'; column: string; action: string };

/** 统一 fixed 弹层宿主：负责选择内容、定位、关闭手势与焦点返回。 */
export class AppPopoverHostElement extends HTMLElement {
  private connection: AbortController | undefined;
  private _viewModel: PopoverViewModel | null = null;
  private lastAnchorId: string | null = null;
  private contentIdentity: string | null = null;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    const signal = this.connection.signal;
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.isOpen()) return;
      event.preventDefault();
      this.requestClose('escape');
    }, { signal });
    document.addEventListener('click', (event) => {
      if (!this.isOpen()) return;
      const target = event.target as Node | null;
      const anchor = this.currentAnchor();
      if ((target && this.contains(target)) || (target && anchor?.contains(target))) return;
      this.requestClose('outside');
    }, { capture: true, signal });
    window.addEventListener('scroll', () => {
      this.repositionOpenPopover();
    }, { capture: true, signal });
    window.addEventListener('resize', () => {
      this.repositionOpenPopover();
    }, { signal });
    this.render(true);
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
    const previousIdentity = this.popoverIdentity(this._viewModel);
    this._viewModel = value;
    if (value.open && value.anchorId) this.lastAnchorId = value.anchorId;
    if (this.isConnected) {
      const nextIdentity = this.popoverIdentity(value);
      this.render(!wasOpen || previousIdentity !== nextIdentity);
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

  private repositionOpenPopover(): void {
    if (!this.isOpen()) return;
    const vm = this._viewModel;
    const anchor = vm?.anchorId ? document.getElementById(vm.anchorId) : null;
    if (!anchor?.isConnected) {
      this.hidden = true;
      this.setAttribute('aria-hidden', 'true');
      this.requestClose('missing-anchor');
      return;
    }
    this.positionFrom(anchor);
  }

  private popoverIdentity(vm: PopoverViewModel | null): string | null {
    return vm?.open && vm.kind && vm.anchorId ? `${vm.kind}:${vm.anchorId}` : null;
  }

  private render(initialFocus: boolean): void {
    const vm = this._viewModel;
    if (!vm?.open || !vm.kind || !vm.anchorId) {
      this.clearContent();
      this.hidden = true;
      this.setAttribute('aria-hidden', 'true');
      return;
    }

    const anchor = document.getElementById(vm.anchorId);
    if (!anchor) {
      this.clearContent();
      this.hidden = true;
      this.setAttribute('aria-hidden', 'true');
      this.requestClose('missing-anchor');
      return;
    }

    if (vm.kind === 'stock-actions') {
      if (!vm.stock) {
        this.clearContent();
        this.hidden = true;
        this.setAttribute('aria-hidden', 'true');
        return;
      }
      const menu = this.contentFor('stock-action-menu', `${vm.kind}:${vm.anchorId}`) as StockActionMenuElement;
      const focused = initialFocus ? null : this.captureFocusedControl(menu);
      menu.viewModel = vm;
      if (focused) this.restoreFocusedControl(menu, focused);
    } else {
      const panel = this.contentFor('column-panel', `${vm.kind}:${vm.anchorId}`) as ColumnPanelElement;
      const focused = initialFocus ? null : this.captureFocusedControl(panel);
      panel.viewModel = vm.columnPanel;
      if (focused) this.restoreFocusedControl(panel, focused);
    }

    this.hidden = false;
    this.setAttribute('aria-hidden', 'false');
    this.style.position = 'fixed';
    this.style.zIndex = '1000';
    this.positionFrom(anchor);
    if (initialFocus) {
      const firstControl = this.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled])'
      );
      firstControl?.focus();
    }
  }

  private clearContent(): void {
    this.replaceChildren();
    this.contentIdentity = null;
  }

  private contentFor(tagName: 'stock-action-menu' | 'column-panel', identity: string): HTMLElement {
    const existing = this.firstElementChild;
    if (this.contentIdentity === identity && existing?.localName === tagName) {
      return existing as HTMLElement;
    }
    this.clearContent();
    const content = document.createElement(tagName);
    this.contentIdentity = identity;
    this.append(content);
    return content;
  }

  private captureFocusedControl(content: HTMLElement): FocusedControl | null {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !content.contains(active)) return null;
    const action = active.dataset.action;
    const column = active.dataset.column;
    const itemColumn = active.closest('[data-column-item]')?.getAttribute('data-column-item');
    if (content.localName === 'stock-action-menu' && action) {
      return { type: 'stock-action', action };
    }
    if (column) return { type: 'column-toggle', column };
    if (itemColumn && action) return { type: 'column-action', column: itemColumn, action };
    return null;
  }

  private restoreFocusedControl(content: HTMLElement, focused: FocusedControl): void {
    let selector: string;
    if (focused.type === 'stock-action') {
      selector = `button[data-action="${focused.action}"]`;
    } else if (focused.type === 'column-toggle') {
      selector = `input[data-column="${focused.column}"]`;
    } else {
      selector = `[data-column-item="${focused.column}"] button[data-action="${focused.action}"]`;
    }
    content.querySelector<HTMLElement>(selector)?.focus();
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
