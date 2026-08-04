// src/popup/components/app-dialog-host.ts
// Task 17 Step 4 — 原生 <dialog> 模态对话框宿主组件。
// 使用 showModal() 打开原生模态。从 DialogState ViewModel 渲染表单。
// 提交 emit dialog-submit（DialogSubmitDetail）。关闭 emit dialog-close-request。
// Escape 关闭并恢复焦点。pending 禁用提交按钮；uncertain 显示对账消息。
// 架构约束：仅 import domain + view-models + events + a11y；per-connection AbortController。
import type { GroupId, StockCode } from '../../domain/brands.js';
import type { DialogViewModel } from '../view-models.js';
import { closedDialog } from '../view-models.js';
import { emitPopupEvent, type DialogSubmitDetail } from './events.js';
import { createDialogController, type DialogController as A11yDialogController } from '../a11y/dialog-controller.js';

/** 从 focusReturnId 解析返回焦点元素。 */
function resolveReturnFocus(id: string | null): HTMLElement | null {
  if (!id) return null;
  return document.getElementById(id);
}

export class AppDialogHostElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: DialogViewModel = closedDialog();
  private controller: A11yDialogController | null = null;

  /** 当前是否已提交（防重复提交）。 */
  private submitted = false;

  private dialogEl: HTMLDialogElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private submitBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    const signal = this.connection.signal;
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    this.bindEvents(signal);
    this.controller = createDialogController((reason) => {
      // Escape/cancel → emit dialog-close-request
      if (reason === 'escape' || reason === 'cancel') {
        emitPopupEvent(this, 'dialog-close-request', { reason: reason === 'escape' ? 'escape' : 'cancel' });
      }
    });
    this.applyViewModel(this._viewModel);
  }

  disconnectedCallback(): void {
    this.connection?.abort();
    this.connection = undefined;
    this.controller?.destroy();
    this.controller = null;
  }

  get viewModel(): DialogViewModel {
    return this._viewModel;
  }

  set viewModel(value: DialogViewModel) {
    const wasOpen = this._viewModel.open;
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value, wasOpen);
  }

  /** 暴露内部 <dialog> 元素。 */
  get dialog(): HTMLDialogElement | null {
    return this.dialogEl;
  }

  private buildSkeleton(): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog';
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    this.dialogEl = dialog;

    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'app-dialog-form';

    const title = document.createElement('h2');
    title.id = 'dialog-title';
    title.className = 'app-dialog-title';
    title.setAttribute('data-region', 'dialog-title');

    const body = document.createElement('div');
    body.className = 'app-dialog-body';
    body.setAttribute('data-region', 'dialog-body');
    this.bodyEl = body;

    const status = document.createElement('div');
    status.className = 'app-dialog-status';
    status.setAttribute('data-region', 'dialog-status');
    status.setAttribute('role', 'alert');
    status.setAttribute('aria-live', 'polite');
    this.statusEl = status;

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    actions.setAttribute('data-region', 'dialog-actions');

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'app-dialog-btn app-dialog-btn--cancel';
    cancelBtn.setAttribute('data-action', 'dialog-cancel');
    cancelBtn.textContent = '取消';
    this.cancelBtn = cancelBtn;

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'app-dialog-btn app-dialog-btn--submit';
    submitBtn.setAttribute('data-action', 'dialog-submit');
    submitBtn.textContent = '确定';
    this.submitBtn = submitBtn;

    actions.append(cancelBtn, submitBtn);
    form.append(title, body, status, actions);
    dialog.append(form);
    this.append(dialog);
  }

  private bindEvents(signal: AbortSignal): void {
    // 事件委托：dialog 内的 click。
    this.dialogEl?.addEventListener('click', ((e: Event) => {
      const target = e.target as HTMLElement;

      // 提交按钮
      const submitBtn = target.closest('button[data-action="dialog-submit"]') as HTMLButtonElement | null;
      if (submitBtn && !submitBtn.disabled) {
        e.preventDefault();
        this.handleSubmit();
        return;
      }

      // 取消按钮
      const cancelBtn = target.closest('button[data-action="dialog-cancel"]') as HTMLButtonElement | null;
      if (cancelBtn && !cancelBtn.disabled) {
        e.preventDefault();
        this.handleCancel();
        return;
      }

      // 删除分组按钮（rename-group 中）
      const deleteBtn = target.closest('button[data-action="dialog-delete-group"]') as HTMLButtonElement | null;
      if (deleteBtn && !deleteBtn.disabled) {
        e.preventDefault();
        this.handleDeleteGroup();
        return;
      }

      // backdrop 点击：点击 dialog 元素本身（而非 form 内容）
      if (target === this.dialogEl) {
        e.preventDefault();
        this.handleBackdrop();
      }
    }) as EventListener, { signal });

    // stock-search-select（来自内部 combobox）：填入 code/name 字段。
    this.addEventListener('stock-search-select', ((e: Event) => {
      const ce = e as CustomEvent<{ code: StockCode; name: string }>;
      if (ce.detail === undefined) return;
      this.handleSearchSelect(ce.detail.code, ce.detail.name);
    }) as EventListener, { signal });
  }

  // ===== 事件处理 =====

  private handleSubmit(): void {
    const vm = this._viewModel;
    if (!vm.open || vm.kind === null) return;
    if (this.submitted || vm.pending) return; // 防重复提交
    const detail = this.gatherSubmitDetail(vm);
    if (!detail) return;
    this.submitted = true;
    emitPopupEvent(this, 'dialog-submit', detail);
    // 以 submit 原因关闭（恢复焦点 + 通知 controller）。
    // 实际关闭由 VM 变为 open=false 驱动；此处先标记。
  }

  private handleCancel(): void {
    emitPopupEvent(this, 'dialog-close-request', { reason: 'cancel' });
  }

  private handleBackdrop(): void {
    emitPopupEvent(this, 'dialog-close-request', { reason: 'backdrop' });
  }

  private handleDeleteGroup(): void {
    const vm = this._viewModel;
    if (!vm.open || vm.renameGroupId === null) return;
    if (this.submitted || vm.pending) return;
    this.submitted = true;
    emitPopupEvent(this, 'dialog-submit', {
      kind: 'delete-group',
      groupId: vm.renameGroupId
    } as DialogSubmitDetail);
  }

  private handleSearchSelect(code: StockCode, name: string): void {
    // 将选中的搜索结果填入 code/name input。
    const codeInput = this.bodyEl?.querySelector('input[data-field="code"]') as HTMLInputElement | null;
    const nameInput = this.bodyEl?.querySelector('input[data-field="name"]') as HTMLInputElement | null;
    if (codeInput) codeInput.value = code;
    if (nameInput) nameInput.value = name;
  }

  // ===== 从表单收集提交数据 =====

  private gatherSubmitDetail(vm: DialogViewModel): DialogSubmitDetail | null {
    const body = this.bodyEl;
    if (!body) return null;

    switch (vm.kind) {
      case 'add-stock': {
        const codeInput = body.querySelector('input[data-field="code"]') as HTMLInputElement | null;
        const nameInput = body.querySelector('input[data-field="name"]') as HTMLInputElement | null;
        const code = (codeInput?.value ?? '').trim() as StockCode;
        const name = (nameInput?.value ?? '').trim();
        if (!code) return null;
        const groupIds = this.collectCheckedGroups(body);
        return { kind: 'add-stock', code, name, groupIds };
      }
      case 'create-group': {
        const nameInput = body.querySelector('input[data-field="name"]') as HTMLInputElement | null;
        const name = (nameInput?.value ?? '').trim();
        if (!name) return null;
        return { kind: 'create-group', name };
      }
      case 'rename-group': {
        const nameInput = body.querySelector('input[data-field="name"]') as HTMLInputElement | null;
        const name = (nameInput?.value ?? '').trim();
        if (!name || vm.renameGroupId === null) return null;
        return { kind: 'rename-group', groupId: vm.renameGroupId, name };
      }
      case 'move-stocks': {
        if (vm.moveCodes.length === 0 || vm.moveFromGroupId === null) return null;
        const targetGroupIds = this.collectCheckedGroups(body);
        return {
          kind: 'move-stocks',
          codes: vm.moveCodes,
          fromGroupId: vm.moveFromGroupId,
          targetGroupIds
        };
      }
      case 'confirm-remove': {
        if (vm.removeCodes.length === 0 || vm.removeGroupId === null) return null;
        return {
          kind: 'remove-stocks',
          codes: vm.removeCodes,
          groupId: vm.removeGroupId
        };
      }
      default:
        return null;
    }
  }

  /** 从 body 内收集选中的 checkbox groupId 列表。 */
  private collectCheckedGroups(body: HTMLElement): GroupId[] {
    const checkboxes = body.querySelectorAll('input[type="checkbox"][data-group-id]');
    const ids: GroupId[] = [];
    for (const cb of Array.from(checkboxes)) {
      const input = cb as HTMLInputElement;
      if (input.checked) {
        ids.push(input.getAttribute('data-group-id') as GroupId);
      }
    }
    return ids;
  }

  // ===== ViewModel 渲染 =====

  private applyViewModel(vm: DialogViewModel, wasOpen?: boolean): void {
    const previouslyOpen = wasOpen ?? this._viewModel.open;

    if (vm.open && !previouslyOpen) {
      // 打开对话框
      this.submitted = false;
      this.renderDialog(vm);
      this.openDialog(vm);
    } else if (vm.open && previouslyOpen) {
      // 已打开，仅更新内容（pending/uncertain/error 等）。
      this.renderDialog(vm);
      this.updateActions(vm);
    } else if (!vm.open && previouslyOpen) {
      // 关闭对话框
      this.closeDialog();
    }

    // 更新操作按钮状态。
    this.updateActions(vm);
  }

  private openDialog(vm: DialogViewModel): void {
    if (!this.dialogEl || !this.controller) return;
    const returnFocus = resolveReturnFocus(vm.focusReturnId);
    // 初始焦点：优先 submit 按钮，其次 cancel，最后 dialog 本身。
    const initialFocus = this.submitBtn ?? this.cancelBtn ?? this.dialogEl;
    this.controller.open(this.dialogEl, initialFocus, returnFocus);
  }

  private closeDialog(): void {
    if (!this.controller) return;
    // 使用 controller.close 关闭并恢复焦点。
    // 这里不传特定 reason（VM 驱动关闭），用 'cancel' 作为安全默认。
    // 如果之前是 submitted 则用 'submit'。
    this.controller.close(this.submitted ? 'submit' : 'cancel');
  }

  private renderDialog(vm: DialogViewModel): void {
    if (!this.bodyEl) return;
    const titleEl = this.querySelector('[data-region="dialog-title"]') as HTMLElement | null;
    this.bodyEl.textContent = '';

    // 标题
    const titles: Record<string, string> = {
      'add-stock': '添加股票',
      'create-group': '新建分组',
      'rename-group': '重命名分组',
      'move-stocks': '移动股票',
      'confirm-remove': '确认移除'
    };
    if (titleEl) titleEl.textContent = vm.kind ? titles[vm.kind] : '';

    // 按 kind 渲染表单
    switch (vm.kind) {
      case 'add-stock':
        this.renderAddStock(vm);
        break;
      case 'create-group':
        this.renderCreateGroup(vm);
        break;
      case 'rename-group':
        this.renderRenameGroup(vm);
        break;
      case 'move-stocks':
        this.renderMoveStocks(vm);
        break;
      case 'confirm-remove':
        this.renderConfirmRemove(vm);
        break;
    }

    // 状态消息（pending/uncertain/error）
    this.updateStatus(vm);
  }

  private renderAddStock(vm: DialogViewModel): void {
    if (!this.bodyEl) return;

    // 搜索 combobox
    const combobox = document.createElement('stock-search-combobox') as HTMLElement & {
      viewModel: unknown;
    };
    combobox.setAttribute('data-region', 'add-search');
    (combobox as unknown as { viewModel: unknown }).viewModel = {
      results: vm.searchResults,
      status: vm.searchStatus,
      generation: vm.searchGeneration
    };
    this.bodyEl.append(combobox);

    // code / name inputs（由 combobox 的 stock-search-select 自动填充）
    const codeField = this.createField('code', '股票代码', 'text', '');
    const nameField = this.createField('name', '股票名称', 'text', '');
    this.bodyEl.append(codeField, nameField);

    // group checkboxes
    const groupSection = this.createGroupCheckboxes(vm.groups, '添加到分组');
    this.bodyEl.append(groupSection);
  }

  private renderCreateGroup(_vm: DialogViewModel): void {
    if (!this.bodyEl) return;
    const nameField = this.createField('name', '分组名称', 'text', '');
    this.bodyEl.append(nameField);
  }

  private renderRenameGroup(vm: DialogViewModel): void {
    if (!this.bodyEl) return;
    const nameField = this.createField('name', '分组名称', 'text', vm.renameCurrentName);
    this.bodyEl.append(nameField);

    if (vm.canDeleteGroup) {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'app-dialog-btn app-dialog-btn--danger';
      deleteBtn.setAttribute('data-action', 'dialog-delete-group');
      deleteBtn.textContent = '删除分组';
      this.bodyEl.append(deleteBtn);
    }
  }

  private renderMoveStocks(vm: DialogViewModel): void {
    if (!this.bodyEl) return;
    const info = document.createElement('p');
    info.className = 'app-dialog-info';
    info.textContent = `将 ${vm.moveCodes.length} 只股票移动到：`;
    this.bodyEl.append(info);

    const groupSection = this.createGroupCheckboxes(vm.groups, '目标分组');
    this.bodyEl.append(groupSection);
  }

  private renderConfirmRemove(vm: DialogViewModel): void {
    if (!this.bodyEl) return;
    const info = document.createElement('p');
    info.className = 'app-dialog-info';
    info.textContent = `确定要移除 ${vm.removeCodes.length} 只股票吗？此操作不可撤销。`;
    this.bodyEl.append(info);
  }

  // ===== 辅助创建方法 =====

  private createField(field: string, label: string, type: string, value: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'app-dialog-field';

    const labelEl = document.createElement('label');
    labelEl.className = 'app-dialog-label';
    labelEl.textContent = label;
    labelEl.setAttribute('for', `dialog-field-${field}`);

    const input = document.createElement('input');
    input.id = `dialog-field-${field}`;
    input.type = type;
    input.value = value;
    input.className = 'app-dialog-input';
    input.setAttribute('data-field', field);
    if (field === 'code') {
      input.setAttribute('placeholder', '如 sh600519');
    }

    wrap.append(labelEl, input);
    return wrap;
  }

  private createGroupCheckboxes(groups: readonly { groupId: GroupId; name: string }[], legend: string): HTMLElement {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'app-dialog-fieldset';

    const legendEl = document.createElement('legend');
    legendEl.className = 'app-dialog-legend';
    legendEl.textContent = legend;
    fieldset.append(legendEl);

    for (const group of groups) {
      const label = document.createElement('label');
      label.className = 'app-dialog-checkbox-label';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'app-dialog-checkbox';
      cb.setAttribute('data-group-id', group.groupId);

      const text = document.createElement('span');
      text.textContent = group.name;

      label.append(cb, text);
      fieldset.append(label);
    }

    return fieldset;
  }

  private updateStatus(vm: DialogViewModel): void {
    if (!this.statusEl) return;
    if (vm.uncertain) {
      this.statusEl.textContent = '正在确认是否已保存…';
      this.statusEl.classList.add('is-visible');
    } else if (vm.errorMessage) {
      this.statusEl.textContent = vm.errorMessage;
      this.statusEl.classList.add('is-visible');
    } else {
      this.statusEl.textContent = '';
      this.statusEl.classList.remove('is-visible');
    }
  }

  private updateActions(vm: DialogViewModel): void {
    if (!this.submitBtn || !this.cancelBtn) return;
    // pending 时禁用提交按钮；uncertain 也禁用。
    const disableSubmit = vm.pending || vm.uncertain || !vm.open;
    this.submitBtn.disabled = disableSubmit;
    this.cancelBtn.disabled = !vm.open;

    // submit 按钮文案按 kind 变化。
    if (vm.kind === 'confirm-remove') {
      this.submitBtn.textContent = '确认移除';
      this.submitBtn.classList.add('app-dialog-btn--danger');
    } else {
      this.submitBtn.textContent = '确定';
      this.submitBtn.classList.remove('app-dialog-btn--danger');
    }
  }
}
