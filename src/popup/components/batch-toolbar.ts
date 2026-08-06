// src/popup/components/batch-toolbar.ts
// Task 16 Step 6 — 批量操作工具栏。
// 显示选中数量 + move/remove/cancel 原生按钮。
// 架构约束：仅 import domain + view-models + events；per-connection AbortController。
import type { BatchToolbarViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';

export class BatchToolbarElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: BatchToolbarViewModel | null = null;
  private countEl: HTMLElement | null = null;
  private selectAllBtn: HTMLButtonElement | null = null;

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

  get viewModel(): BatchToolbarViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: BatchToolbarViewModel) {
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value);
  }

  private buildSkeleton(): void {
    this.className = 'batch-toolbar';
    this.setAttribute('role', 'toolbar');
    // 与入口按钮同名：读屏用户从「管理持仓」进来，落到的工具栏也该叫这个。
    this.setAttribute('aria-label', '持仓管理');

    const countEl = document.createElement('span');
    countEl.className = 'batch-toolbar-count';
    countEl.textContent = '已选择 0 项';
    this.countEl = countEl;

    const moveBtn = document.createElement('button');
    moveBtn.type = 'button';
    moveBtn.className = 'batch-toolbar-btn';
    moveBtn.setAttribute('data-action', 'batch-move');
    moveBtn.setAttribute('aria-label', '移动选中股票到其他分组');
    moveBtn.textContent = '移动';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.className = 'batch-toolbar-btn';
    selectAllBtn.setAttribute('data-action', 'batch-select-all');
    selectAllBtn.setAttribute('aria-label', '全选');
    selectAllBtn.textContent = '全选';
    this.selectAllBtn = selectAllBtn;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'batch-toolbar-btn batch-toolbar-btn--danger';
    removeBtn.setAttribute('data-action', 'batch-remove');
    removeBtn.setAttribute('aria-label', '移除选中股票');
    removeBtn.textContent = '移除';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'batch-toolbar-btn';
    cancelBtn.setAttribute('data-action', 'batch-cancel');
    cancelBtn.setAttribute('aria-label', '退出持仓管理');
    cancelBtn.textContent = '取消';

    this.append(countEl, selectAllBtn, moveBtn, removeBtn, cancelBtn);
  }

  private bindEvents(signal: AbortSignal): void {
    this.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      const btn = target.closest('button[data-action]') as HTMLButtonElement | null;
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      switch (action) {
        case 'batch-move':
          emitPopupEvent(this, 'dialog-open-request', { kind: 'move-stocks' });
          break;
        case 'batch-remove':
          emitPopupEvent(this, 'dialog-open-request', { kind: 'confirm-remove' });
          break;
        case 'batch-select-all':
          emitPopupEvent(this, 'batch-select-all', {});
          break;
        case 'batch-cancel':
          emitPopupEvent(this, 'selection-mode-change', { enabled: false });
          break;
      }
    }, { signal });
  }

  private applyViewModel(vm: BatchToolbarViewModel): void {
    if (vm.visible) {
      this.removeAttribute('hidden');
    } else {
      this.setAttribute('hidden', '');
    }
    if (this.countEl) {
      this.countEl.textContent = `已选择 ${vm.selectedCount} 项`;
    }
    if (this.selectAllBtn) {
      const allSelected = vm.totalCount > 0 && vm.selectedCount >= vm.totalCount;
      const label = allSelected ? '取消全选' : '全选';
      this.selectAllBtn.textContent = label;
      // aria-label 优先于可见文本，只改 textContent 会让读屏永远念「全选」，
      // 哪怕按钮此刻的作用是取消全选。
      this.selectAllBtn.setAttribute('aria-label', label);
    }
  }
}
