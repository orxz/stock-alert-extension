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
  private _selectionMode = false;
  private manageBtn: HTMLButtonElement | null = null;

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

  get selectionMode(): boolean {
    return this._selectionMode;
  }

  set selectionMode(value: boolean) {
    this._selectionMode = value;
    if (this.manageBtn) {
      this.manageBtn.setAttribute('aria-pressed', String(value));
      this.manageBtn.classList.toggle('is-active', value);
    }
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
    // 分组管理区：紧贴 tablist（+新建 + 重排按钮动态填充）。
    const groupActions = document.createElement('div');
    groupActions.setAttribute('data-region', 'group-actions');
    groupActions.className = 'group-tabs-group-actions';

    // 新建分组按钮（图标 + 文字，与 Header 按钮风格一致）。
    const addGroupBtn = document.createElement('button');
    addGroupBtn.type = 'button';
    addGroupBtn.className = 'tabs-btn';
    addGroupBtn.setAttribute('data-action', 'add-group');
    addGroupBtn.setAttribute('aria-label', '新建分组');
    addGroupBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span>新建</span>';

    // 重排按钮容器（keyed 动态填充）。
    const reorderSlot = document.createElement('div');
    reorderSlot.setAttribute('data-region', 'tab-actions');
    reorderSlot.className = 'group-tabs-reorder';

    groupActions.append(addGroupBtn, reorderSlot);

    // 持仓管理按钮区：靠右。
    const rightActions = document.createElement('div');
    rightActions.setAttribute('data-region', 'right-actions');
    rightActions.className = 'group-tabs-right-actions';

    // 「多选」描述的是交互手段（能勾选多行），不是用户来这里要做的事。
    // 这个模式的出口是全选 / 移动到分组 / 移除——即成批地管理自选持仓，
    // 故按钮与整个模式统一命名为「管理持仓」。
    const manageBtn = document.createElement('button');
    manageBtn.type = 'button';
    manageBtn.className = 'tabs-btn tabs-btn--toggle';
    manageBtn.setAttribute('data-action', 'manage-holdings');
    manageBtn.setAttribute('aria-pressed', 'false');
    manageBtn.setAttribute('aria-label', '管理持仓');
    // stroke-width 2.3：渲染后线重 = 2.3 × 13/24 ≈ 1.25px，与同排的「新建」(2.4)
    // 和重排箭头 (2.5 × 12/24) 一致；用 2 会明显比旁边的图标细一档。
    manageBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 12.2l2.6 2.6 4.6-5.2"/></svg><span>管理持仓</span>';
    this.manageBtn = manageBtn;
    rightActions.append(manageBtn);

    nav.append(tablist, groupActions, rightActions);
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

      // 管理持仓切换按钮 → selection-mode-change。
      const manageBtn = target.closest('button[data-action="manage-holdings"]') as HTMLButtonElement | null;
      if (manageBtn) {
        emitPopupEvent(this, 'selection-mode-change', { enabled: !this._selectionMode });
        return;
      }

      // 新建分组按钮 → dialog-open-request(create-group)。
      const addGroupBtn = target.closest('button[data-action="add-group"]') as HTMLButtonElement | null;
      if (addGroupBtn) {
        emitPopupEvent(this, 'dialog-open-request', { kind: 'create-group' });
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

    // 双击分组标签 → 重命名（自定义分组）。
    // 必须带上被点标签的 groupId：右键不会激活标签，回落 currentGroupId 会改错分组。
    nav.addEventListener('dblclick', (e: Event) => {
      const target = e.target as HTMLElement;
      const tab = target.closest('button[role="tab"]') as HTMLButtonElement | null;
      if (!tab) return;
      const groupId = tab.getAttribute('data-group-id')!;
      if (groupId === DEFAULT_GROUP_ID) return; // g_all 不可重命名
      e.preventDefault(); // 否则双击会选中标签文字
      emitPopupEvent(this, 'dialog-open-request', { kind: 'rename-group', groupId: groupId as GroupId });
    }, { signal });

    // 右键分组标签 → 重命名（对话框内含删除按钮，g_all 不响应）。
    nav.addEventListener('contextmenu', (e: Event) => {
      const target = e.target as HTMLElement;
      const tab = target.closest('button[role="tab"]') as HTMLButtonElement | null;
      if (!tab) return;
      const groupId = tab.getAttribute('data-group-id')!;
      if (groupId === DEFAULT_GROUP_ID) return;
      e.preventDefault();
      emitPopupEvent(this, 'dialog-open-request', { kind: 'rename-group', groupId: groupId as GroupId });
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
    // 现在只有激活分组显示箭头（最多一对），可以放进 Tab 序列。
    // 之前每组常驻一对、共 2N 个，才不得不用 tabindex=-1 挡住，
    // 代价是分组重排完全无法用键盘完成。
    moveLeft.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

    const moveRight = document.createElement('button');
    moveRight.type = 'button';
    moveRight.className = 'group-tab-move';
    moveRight.setAttribute('data-action', 'move-right');
    moveRight.setAttribute('data-group-id', vm.groupId);

    moveRight.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

    group.append(moveLeft, moveRight);
    this.updateMoveButtons(group, vm);
    return group;
  }

  private updateMoveButtons(node: HTMLElement, vm: GroupTabViewModel): void {
    // 只为**当前激活**的自定义分组显示重排箭头。
    // 每组常驻一对箭头会让标签栏的固定宽度随分组数线性增长（每组 +52px）：
    // 420px 面板在 6 个分组时就把右侧「管理持仓」挤出可视区，而移到标签栏后
    // 该按钮已是进入持仓管理模式的唯一入口，被裁掉就再也进不去。
    // 改成「先选中分组、再移动」后这段宽度恒定（最多一对箭头）。
    // 只改可见性，不提前返回：disabled / aria-label 始终保持正确，
    // 分组一旦被激活就是就绪状态，也不破坏「每组都有一对按钮」的 DOM 契约。
    node.hidden = vm.groupId === DEFAULT_GROUP_ID || !vm.isActive;

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
