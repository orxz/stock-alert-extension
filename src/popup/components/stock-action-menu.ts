// src/popup/components/stock-action-menu.ts
// 单只股票的操作菜单：置顶 / 上移 / 下移 / 删除。
//
// 只接收 ViewModel、只发语义事件——不访问 Store / RPC / Storage，
// 也不自行判断「能不能上移」：可用性由 selector 算好后随 VM 下发。
//
// 删除走确认对话框（stock-remove-confirm-request），绝不即时删除：
// 自选股删除是不可撤销的破坏性操作。
import type { StockActionMenuViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';
import { moveKey } from './stock-card.js';

interface ActionDef {
  readonly action: string;
  readonly label: (vm: StockActionMenuViewModel) => string;
  readonly enabled: (vm: StockActionMenuViewModel) => boolean;
}

const ACTIONS: readonly ActionDef[] = [
  {
    action: 'pin',
    label: (vm) => (vm.pinned ? '取消置顶' : '置顶'),
    enabled: () => true
  },
  { action: 'move-up', label: () => '上移', enabled: (vm) => vm.canMoveUp },
  { action: 'move-down', label: () => '下移', enabled: (vm) => vm.canMoveDown },
  { action: 'remove', label: () => '删除', enabled: () => true }
];

export class StockActionMenuElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: StockActionMenuViewModel | null = null;
  private readonly buttons = new Map<string, HTMLButtonElement>();

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    this.bindEvents(this.connection.signal);
    if (this._viewModel) this.applyViewModel(this._viewModel);
  }

  disconnectedCallback(): void {
    this.connection?.abort();
    this.connection = undefined;
  }

  get viewModel(): StockActionMenuViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: StockActionMenuViewModel | null) {
    this._viewModel = value;
    if (this.isConnected && value) this.applyViewModel(value);
  }

  private buildSkeleton(): void {
    this.className = 'stock-action-menu';
    this.setAttribute('role', 'menu');
    for (const def of ACTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stock-action-menu-item';
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('data-action', def.action);
      if (def.action === 'remove') btn.classList.add('is-destructive');
      this.buttons.set(def.action, btn);
      this.append(btn);
    }
  }

  private bindEvents(signal: AbortSignal): void {
    this.addEventListener('click', (event: Event) => {
      const btn = (event.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;
      this.dispatch(btn.getAttribute('data-action') ?? '');
    }, { signal });
  }

  private dispatch(action: string): void {
    const vm = this._viewModel;
    if (!vm) return;
    const ordered = [...vm.orderedCodes];

    switch (action) {
      case 'pin': {
        const pinned = !vm.pinned;
        emitPopupEvent(this, 'stock-pin-request', {
          code: vm.code,
          pinned,
          // 置顶时把自己提到最前，取消置顶保持当前顺序。
          orderedCodes: pinned ? [vm.code, ...ordered.filter((c) => c !== vm.code)] : ordered
        });
        break;
      }
      case 'move-up':
        emitPopupEvent(this, 'stock-order-request', {
          groupId: vm.groupId,
          orderedCodes: moveKey(ordered, vm.code, -1)
        });
        break;
      case 'move-down':
        emitPopupEvent(this, 'stock-order-request', {
          groupId: vm.groupId,
          orderedCodes: moveKey(ordered, vm.code, 1)
        });
        break;
      case 'remove':
        // 交给确认对话框——不在这里直接删。
        emitPopupEvent(this, 'stock-remove-confirm-request', {
          code: vm.code,
          groupId: vm.groupId
        });
        return;
      default:
        return;
    }
    // 执行完一个动作后关闭菜单（删除除外——它由对话框接管）。
    emitPopupEvent(this, 'popover-close-request', {});
  }

  private applyViewModel(vm: StockActionMenuViewModel): void {
    for (const def of ACTIONS) {
      const btn = this.buttons.get(def.action);
      if (!btn) continue;
      const label = def.label(vm);
      if (btn.textContent !== label) btn.textContent = label;
      btn.disabled = !def.enabled(vm);
      btn.setAttribute('aria-label', `${label} ${vm.name}`);
    }
  }
}
