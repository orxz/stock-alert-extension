// src/popup/components/group-tabs.ts
// Task 15 Step 4 — WAI-ARIA tablist 分组导航组件。
// nav > [role=tablist]；每组 button[role=tab] 含 aria-selected、roving tabindex、
// aria-controls="stock-board"。ArrowLeft/Right/Home/End 移焦点并选中（自动激活）；
// Enter/Space 选中当前 tab。自定义组（非 g_all）暴露「左移/右移」按钮，
// 发出包含完整 orderedGroupIds 的 group-order-request。
// 架构约束：仅 import domain + view-models + events + keyed-update；per-connection AbortController。
// ARIA 约束：tablist 的直接子元素必须全部是 role=tab（axe aria-required-children）；
// 左移/右移按钮放在 tablist 外的独立 actions 容器（tablist 不允许非 tab 子元素）。
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
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    this.connection?.abort();
    const controller = new AbortController();
    this.connection = controller;
    this.bindContainerEvents(controller.signal);
    if (this.isConnected) this.render();
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
    // 重排按钮容器：tablist 外，避免非 tab 子元素污染 tablist 角色。
    const actions = document.createElement('div');
    actions.setAttribute('data-region', 'tab-actions');
    actions.className = 'group-tabs-actions';
    nav.append(actions);
    this.append(nav);
  }

  /**
   * 事件委托：在 nav 容器上绑定 click + keydown（覆盖 tablist 与 actions）。
   * connectedCallback 时绑定（signal 随连接生命周期），断开自动移除。
   */
  private bindContainerEvents(signal: AbortSignal): void {
    const nav = this.querySelector('nav');
    if (!nav) return;

    nav.addEventListener('click', (e: Event) => {
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
        const groupId = moveBtn.getAttribute('data-group-id');
        if (groupId) {
          const orderedIds = this.computeReorder(groupId, direction);
          emitPopupEvent(this, 'group-order-request', { orderedGroupIds: orderedIds });
        }
      }
    }, { signal });

    nav.addEventListener('keydown', ((e: Event) => {
      const target = e.target as HTMLElement;
      const tab = target.closest('button[role="tab"]') as HTMLButtonElement | null;
      if (!tab) return;
      const groupId = tab.getAttribute('data-group-id')!;
      this.handleTabKeydown(e as KeyboardEvent, groupId);
    }) as EventListener, { signal });
  }

  private render(): void {
    const tablist = this.querySelector('[data-region="tablist"]');
    const actions = this.querySelector('[data-region="tab-actions"]');
    if (!tablist || !actions) return;

    // 焦点保持：重渲染前记录焦点 groupId，渲染后恢复到同一 tab。
    const focusedGroupId = document.activeElement?.getAttribute('data-group-id') ?? null;

    // tablist：直接子元素全部是 button[role=tab]。
    updateKeyedChildren(
      tablist,
      this._viewModel,
      (vm) => vm.groupId,
      (vm) => this.createTab(vm),
      (node, vm) => this.updateTab(node as HTMLButtonElement, vm)
    );

    // actions：每个自定义组一个 move 按钮组（keyed 同 groupId）。
    updateKeyedChildren(
      actions,
      this._viewModel,
      (vm) => `move:${vm.groupId}`,
      (vm) => this.createMoveButtons(vm),
      (node, vm) => this.updateMoveButtons(node, vm)
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

  /** 创建纯 tab 按钮（tablist 直接子元素）。 */
  private createTab(vm: GroupTabViewModel): HTMLButtonElement {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('data-group-id', vm.groupId);
    tab.setAttribute('aria-controls', 'stock-board');
    tab.className = 'group-tab';
    this.updateTab(tab, vm);
    return tab;
  }

  private updateTab(tab: HTMLButtonElement, vm: GroupTabViewModel): void {
    tab.setAttribute('aria-selected', String(vm.isActive));
    tab.setAttribute('tabindex', vm.isActive ? '0' : '-1');
    tab.textContent = vm.name;
    tab.classList.toggle('is-active', vm.isActive);
  }

  /** 创建某分组对应的左移/右移按钮组（tablist 外）。 */
  private createMoveButtons(vm: GroupTabViewModel): HTMLElement {
    const group = document.createElement('span');
    group.className = 'group-tab-move-group';
    group.setAttribute('data-group-id', vm.groupId);

    if (vm.groupId === DEFAULT_GROUP_ID) {
      group.hidden = true; // g_all 不可重排，占位保持 keyed 对齐
      return group;
    }

    const moveLeft = document.createElement('button');
    moveLeft.type = 'button';
    moveLeft.className = 'group-tab-move';
    moveLeft.setAttribute('data-action', 'move-left');
    moveLeft.setAttribute('data-group-id', vm.groupId);
    moveLeft.setAttribute('tabindex', '-1');
    moveLeft.textContent = '◀';

    const moveRight = document.createElement('button');
    moveRight.type = 'button';
    moveRight.className = 'group-tab-move';
    moveRight.setAttribute('data-action', 'move-right');
    moveRight.setAttribute('data-group-id', vm.groupId);
    moveRight.setAttribute('tabindex', '-1');
    moveRight.textContent = '▶';

    group.append(moveLeft, moveRight);
    this.updateMoveButtons(group, vm);
    return group;
  }

  private updateMoveButtons(node: HTMLElement, vm: GroupTabViewModel): void {
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
