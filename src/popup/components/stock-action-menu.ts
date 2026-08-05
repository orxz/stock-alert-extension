import type { StockCode } from '../../domain/index.js';
import type { PopoverViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';

function moveCode(
  orderedCodes: readonly StockCode[],
  code: StockCode,
  delta: -1 | 1
): StockCode[] {
  const result = [...orderedCodes];
  const from = result.indexOf(code);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= result.length) return result;
  [result[from], result[to]] = [result[to], result[from]];
  return result;
}

/** 纯 ViewModel 驱动的单股票操作菜单；仅发出语义事件。 */
export class StockActionMenuElement extends HTMLElement {
  private connection: AbortController | undefined;
  private _viewModel: PopoverViewModel | null = null;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    this.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
      if (!button || button.disabled) return;
      this.activate(button.dataset.action ?? '');
    }, { signal: this.connection.signal });
    this.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(this.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
      if (buttons.length === 0) return;
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      let next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % buttons.length;
      else next = current <= 0 ? buttons.length - 1 : current - 1;
      event.preventDefault();
      buttons[next].focus();
    }, { signal: this.connection.signal });
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
    this._viewModel = value;
    if (this.isConnected) this.render();
  }

  private activate(action: string): void {
    const vm = this._viewModel;
    const stock = vm?.stock;
    if (!vm || vm.kind !== 'stock-actions' || !stock) return;

    if (action === 'pin') {
      const pinned = !stock.pinned;
      emitPopupEvent(this, 'stock-pin-request', {
        code: stock.code,
        pinned,
        orderedCodes: pinned
          ? [stock.code, ...vm.orderedCodes.filter((code) => code !== stock.code)]
          : [...vm.orderedCodes]
      });
      return;
    }
    if (action === 'move-up' || action === 'move-down') {
      emitPopupEvent(this, 'stock-order-request', {
        groupId: vm.groupId,
        orderedCodes: moveCode(vm.orderedCodes, stock.code, action === 'move-up' ? -1 : 1)
      });
      return;
    }
    if (action === 'remove') {
      emitPopupEvent(this, 'stock-remove-confirm-request', { code: stock.code });
    }
  }

  private render(): void {
    this.textContent = '';
    const vm = this._viewModel;
    const stock = vm?.stock;
    if (!vm?.open || vm.kind !== 'stock-actions' || !stock) {
      this.hidden = true;
      return;
    }

    this.hidden = false;
    this.className = 'stock-action-menu';
    this.setAttribute('role', 'menu');
    this.setAttribute('aria-label', `${stock.name} 操作`);
    const index = vm.orderedCodes.indexOf(stock.code);
    this.append(
      this.button('pin', stock.pinned ? `取消置顶 ${stock.name}` : `置顶 ${stock.name}`, stock.pinned ? '取消置顶' : '置顶'),
      this.button('move-up', `上移 ${stock.name}`, '上移', index <= 0),
      this.button('move-down', `下移 ${stock.name}`, '下移', index < 0 || index === vm.orderedCodes.length - 1),
      this.button('remove', `移除 ${stock.name}`, '移除')
    );
  }

  private button(action: string, label: string, text: string, disabled = false): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stock-action-menu-btn';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.setAttribute('role', 'menuitem');
    button.textContent = text;
    button.disabled = disabled;
    return button;
  }
}
