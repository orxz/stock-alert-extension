// src/popup/components/group-tabs.ts
// Task 15 Step 4 — WAI-ARIA tablist 分组导航组件。
// nav > [role=tablist]；每组 button[role=tab] 含 aria-selected、roving tabindex、
// aria-controls="stock-board"。ArrowLeft/Right/Home/End 移焦点并选中（自动激活）；
// Enter/Space 选中当前 tab。自定义组（非 g_all）暴露「左移/右移」按钮，
// 发出包含完整 orderedGroupIds 的 group-order-request。
// 架构约束：仅 import domain + view-models + events + keyed-update；per-connection AbortController。
// 事件委托：监听器挂在 tablist 容器上（connectedCallback 时绑定），新增/复用 tab 自动覆盖。
import type { GroupId } from '../../domain/brands.js';
import type { GroupTabViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';
import { updateKeyedChildren } from './keyed-update.js';

/** 固定计算视图分组 ID（不可重排）。 */
const DEFAULT_GROUP_ID = 'g_all';

export class GroupTabsElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: readonly GroupTabViewModel[] = [];

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    const signal = this.connection.signal;
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    this.bindContainerEvents(signal);
    this.render();
  }

  disconnectedCallback(): void {
    this.connection?.abort();
    this.connection = undefined;
  }

  get viewModel(): readonly GroupTabViewModel[] {
    return this._viewModel;
  }

  set viewModel(value: readonly GroupTabViewModel[]) {
    this._viewModel = value;
    if (this.isConnected) this.render();
  }

  private buildSkeleton(): void {
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', '股票分组');
    nav.className = 'group-tabs-nav';
    const tablist = document.createElement('div');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-orientation', 'horizontal');
    tablist.setAttribute('data-region', 'tablist');
    tablist.className = 'group-tabs-tablist';
    nav.append(tablist);
    this.append(nav);
  }

  /**
   * 事件委托：在 tablist 容器上绑定 click + keydown。
   * connectedCallback 时绑定（signal 随连接生命周期），断开自动移除。
   * 新增/复用 tab 节点无需单独绑定——委托覆盖全部子节点。
   */
  private bindContainerEvents(signal: AbortSignal): void {
    const tablist = this.querySelector('[data-region="tablist"]');
    if (!tablist) return;

    tablist.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;

      // Tab 点击 → group-select。
      const tab = target.closest('button[role="tab"]') as HTMLButtonElement | null;
      if (tab && !tab.disabled) {
        const groupId = tab.getAttribute('data-group-id')!;
        emitPopupEvent(this, 'group-select', { groupId: groupId as GroupId });
        return;
      }

      // 左移/右移按钮 → group-order-request。
      const moveBtn = target.closest('button[data-action^="move-"]') as HTMLButtonElement | null;
      if (moveBtn && !moveBtn.disabled) {
        const action = moveBtn.getAttribute('data-action')!;
        const direction = action === 'move-left' ? 'left' : 'right';
        const item = moveBtn.closest('.group-tab-item') as HTMLElement | null;
        const groupId = item?.querySelector('button[role="tab"]')?.getAttribute('data-group-id');
        if (groupId) {
          const orderedIds = this.computeReorder(groupId, direction);
          emitPopupEvent(this, 'group-order-request', { orderedGroupIds: orderedIds });
        }
      }
    }, { signal });

    tablist.addEventListener('keydown', ((e: Event) => {
      const target = e.target as HTMLElement;
      const tab = target.closest('button[role="tab"]') as HTMLButtonElement | null;
      if (!tab) return;
      const groupId = tab.getAttribute('data-group-id')!;
      this.handleTabKeydown(e as KeyboardEvent, groupId);
    }) as EventListener, { signal });
  }

  private render(): void {
    const tablist = this.querySelector('[data-region="tablist"]');
    if (!tablist) return;

    // 焦点保持：重渲染前记录焦点 groupId，渲染后恢复到同一 tab。
    const focusedGroupId = document.activeElement?.getAttribute('data-group-id') ?? null;

    updateKeyedChildren(
      tablist,
      this._viewModel,
      (vm) => vm.groupId,
      (vm) => this.createTabItem(vm),
      (node, vm) => this.updateTabItem(node, vm)
    );

    // 恢复焦点到同一 group 的 tab（keyed reorder 后 DOM 位置变化但节点复用）。
    if (focusedGroupId) {
      const tabToFocus = tablist.querySelector(
        `button[data-group-id="${focusedGroupId}"][role="tab"]`
      ) as HTMLElement | null;
      if (tabToFocus && document.activeElement !== tabToFocus) {
        tabToFocus.focus();
      }
    }
  }

  private createTabItem(vm: GroupTabViewModel): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'group-tab-item';

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('data-group-id', vm.groupId);
    tab.setAttribute('aria-controls', 'stock-board');
    tab.className = 'group-tab';
    tab.textContent = vm.name;

    wrapper.append(tab);

    // 自定义组（非 g_all）添加左移/右移按钮。
    if (vm.groupId !== DEFAULT_GROUP_ID) {
      const moveLeft = document.createElement('button');
      moveLeft.type = 'button';
      moveLeft.className = 'group-tab-move';
      moveLeft.setAttribute('data-action', 'move-left');
      moveLeft.setAttribute('aria-label', `左移 ${vm.name}`);
      moveLeft.setAttribute('tabindex', '-1');
      moveLeft.textContent = '◀';

      const moveRight = document.createElement('button');
      moveRight.type = 'button';
      moveRight.className = 'group-tab-move';
      moveRight.setAttribute('data-action', 'move-right');
      moveRight.setAttribute('aria-label', `右移 ${vm.name}`);
      moveRight.setAttribute('tabindex', '-1');
      moveRight.textContent = '▶';

      wrapper.append(moveLeft, moveRight);
    }

    // 对新建节点也应用初始状态（aria-selected / tabindex / disabled）。
    this.updateTabItem(wrapper, vm);
    return wrapper;
  }

  private updateTabItem(node: HTMLElement, vm: GroupTabViewModel): void {
    const tab = node.querySelector('button[role="tab"]') as HTMLButtonElement | null;
    if (tab) {
      tab.setAttribute('aria-selected', String(vm.isActive));
      tab.setAttribute('tabindex', vm.isActive ? '0' : '-1');
      tab.textContent = vm.name;
      tab.classList.toggle('is-active', vm.isActive);
    }

    // 左移/右移按钮 disabled 状态。
    const tabs = this._viewModel;
    const index = tabs.findIndex((t) => t.groupId === vm.groupId);
    const firstCustomIndex = tabs.findIndex((t) => t.groupId !== DEFAULT_GROUP_ID);
    const isLast = index === tabs.length - 1;
    const isFirstCustom = index === firstCustomIndex;

    const moveLeft = node.querySelector('button[data-action="move-left"]') as HTMLButtonElement | null;
    const moveRight = node.querySelector('button[data-action="move-right"]') as HTMLButtonElement | null;
    if (moveLeft) {
      moveLeft.disabled = isFirstCustom;
      moveLeft.setAttribute('aria-label', `左移 ${vm.name}`);
    }
    if (moveRight) {
      moveRight.disabled = isLast;
      moveRight.setAttribute('aria-label', `右移 ${vm.name}`);
    }
  }

  private handleTabKeydown(e: KeyboardEvent, currentGroupId: string): void {
    const tabs = Array.from(
      this.querySelectorAll('button[role="tab"]')
    ) as HTMLButtonElement[];
    const currentIndex = tabs.findIndex((t) => t.getAttribute('data-group-id') === currentGroupId);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        emitPopupEvent(this, 'group-select', { groupId: currentGroupId as GroupId });
        return;
      default:
        return;
    }

    if (nextIndex !== null && nextIndex !== currentIndex) {
      e.preventDefault();
      const nextTab = tabs[nextIndex];
      const nextGroupId = nextTab.getAttribute('data-group-id')!;
      nextTab.focus();
      emitPopupEvent(this, 'group-select', { groupId: nextGroupId as GroupId });
    }
  }

  /**
   * 计算重排后的完整 orderedGroupIds 数组。
   * 'left'：与前一元素交换；'right'：与后一元素交换。
   */
  private computeReorder(groupId: string, direction: 'left' | 'right'): GroupId[] {
    const ids = this._viewModel.map((t) => t.groupId);
    const i = ids.indexOf(groupId as GroupId);
    if (i < 0) return ids;
    const j = direction === 'left' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return ids;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return ids;
  }
}
