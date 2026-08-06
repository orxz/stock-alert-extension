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
  /** 当前已渲染的对话框 kind——仅在 kind 变化时重建 body 结构，避免焦点丢失。 */
  private renderedKind: DialogViewModel['kind'] = null;

  /** 当前是否已提交（防重复提交）。 */
  private submitted = false;

  private dialogEl: HTMLDialogElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private submitBtn: HTMLButtonElement | null = null;
  private deleteBtn: HTMLButtonElement | null = null;
  private validationEl: HTMLElement | null = null;
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

    // 表单内校验提示（与 status 分开：status 承载 mutation 的 pending/error，
    // 这条是「你填的内容不合法」，两者会同时出现）。
    const validation = document.createElement('p');
    validation.className = 'app-dialog-validation';
    validation.setAttribute('data-region', 'dialog-validation');
    validation.setAttribute('aria-live', 'polite');
    validation.hidden = true;
    this.validationEl = validation;

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

    // 删除分组：常驻底部操作栏最左侧，与「取消/确定」之间用 margin-right:auto
    // 拉开距离——破坏性操作不该和确认操作挨在一起，更不该混在表单正文里
    // （之前它就长在正文里，紧跟着名称输入框，误触风险高）。
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'app-dialog-btn app-dialog-btn--danger app-dialog-btn--delete';
    deleteBtn.setAttribute('data-action', 'dialog-delete-group');
    deleteBtn.textContent = '删除分组';
    deleteBtn.hidden = true;
    this.deleteBtn = deleteBtn;

    actions.append(deleteBtn, cancelBtn, submitBtn);
    form.append(title, body, validation, status, actions);
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

    // 任何输入都要重算「确定」的可用性。
    // 必须监听 input 事件而不是只在选中时更新——分组名是手敲的，
    // 而 Playwright 的 fill() 也是通过派发 input 来写值的。
    this.addEventListener('input', () => {
      this.updateSubmitEnabled();
    }, { signal });
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
    this.updatePickedStock(code, name);
    this.updateSubmitEnabled();
  }

  /**
   * 显示「已选择 X」。
   * 承载数据的 code/name 两个输入框是视觉隐藏的，选完之后界面上没有任何地方
   * 告诉用户到底选中了哪只——这里补上唯一的确认反馈。
   */
  private updatePickedStock(code: string, name: string): void {
    const picked = this.bodyEl?.querySelector('.app-dialog-picked') as HTMLElement | null;
    if (!picked) return;
    if (!code) {
      picked.hidden = true;
      picked.textContent = '';
      return;
    }
    picked.hidden = false;
    picked.textContent = '';
    const label = document.createElement('span');
    label.className = 'app-dialog-picked-label';
    label.textContent = '已选择';
    const nameEl = document.createElement('span');
    nameEl.className = 'app-dialog-picked-name';
    nameEl.textContent = name || code;
    const codeEl = document.createElement('span');
    codeEl.className = 'app-dialog-picked-code';
    codeEl.textContent = code;
    picked.append(label, nameEl, codeEl);
  }

  /**
   * 必填项没填时禁用「确定」。
   * 在此之前，没选股票就点确定会走到 gatherSubmitDetail 返回 null，然后
   * **什么都不发生**——用户得不到任何反馈，只能反复点。create/rename-group
   * 的空名称也是同一条死路。
   */
  private updateSubmitEnabled(): void {
    if (!this.submitBtn) return;
    const vm = this._viewModel;
    const blocked = vm.pending || vm.uncertain || !vm.open || !this.hasRequiredInput(vm);
    this.submitBtn.disabled = blocked;
    this.renderValidation(vm);
  }

  private hasRequiredInput(vm: DialogViewModel): boolean {
    return !this.validateInput(vm).blocked;
  }

  /**
   * 校验当前表单。
   * blocked 决定「确定」是否可用；message 只在**填了但不合法**时给出——
   * 刚打开对话框、什么都还没输入时不该立刻red字质问用户。
   *
   * 分组重名在命令层是硬校验（那里才是所有写入的必经之路），这里再做一次
   * 同样的判断，是为了把反馈提前到输入的那一刻，而不是等点完「确定」、
   * 对话框关闭之后再从 toast 里知道撞名了。
   */
  private validateInput(vm: DialogViewModel): { blocked: boolean; message: string | null } {
    const body = this.bodyEl;
    if (!body) return { blocked: false, message: null };
    const valueOf = (field: string): string =>
      ((body.querySelector(`input[data-field="${field}"]`) as HTMLInputElement | null)?.value ?? '').trim();
    const ok = { blocked: false, message: null };

    switch (vm.kind) {
      case 'add-stock':
        return valueOf('code').length > 0 ? ok : { blocked: true, message: null };
      case 'create-group':
      case 'rename-group': {
        const name = valueOf('name').replace(/\s+/g, ' ');
        if (!name) return { blocked: true, message: null };
        const key = name.toLocaleLowerCase();
        // 重命名时排除自己：把「科技」改成「科技」不算重名。
        const clash = vm.groups.some(
          (g) =>
            g.groupId !== vm.renameGroupId &&
            g.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase() === key
        );
        return clash ? { blocked: true, message: `已有同名分组「${name}」` } : ok;
      }
      default:
        return ok;
    }
  }

  /** 把校验信息渲染到字段下方，并同步「确定」的可用性。 */
  private renderValidation(vm: DialogViewModel): void {
    const { message } = this.validateInput(vm);
    if (this.validationEl) {
      this.validationEl.textContent = message ?? '';
      this.validationEl.hidden = message === null;
    }
    // 名称输入框同步 aria-invalid，读屏用户才知道是这一项出了问题。
    const nameInput = this.bodyEl?.querySelector('input[data-field="name"]') as HTMLInputElement | null;
    if (nameInput) {
      if (message) nameInput.setAttribute('aria-invalid', 'true');
      else nameInput.removeAttribute('aria-invalid');
    }
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
      // 已打开：仅当 kind 变化时才重建 body 结构；
      // kind 不变时只做增量更新（combobox viewModel / status / actions）。
      if (this.renderedKind !== vm.kind) {
        this.renderDialog(vm);
      } else {
        this.updateDialogContent(vm);
      }
      this.updateActions(vm);
    } else if (!vm.open && previouslyOpen) {
      // 关闭对话框
      this.closeDialog();
      this.renderedKind = null;
    }

    // 更新操作按钮状态。
    this.updateActions(vm);
  }

  /**
   * 增量更新已打开的对话框内容：只更新 combobox viewModel 和 status/actions，
   * 绝不销毁/重建 body DOM——否则正在输入的焦点元素会被移除。
   */
  private updateDialogContent(vm: DialogViewModel): void {
    // add-stock：只更新 combobox 的 viewModel（搜索结果/status/generation）。
    if (vm.kind === 'add-stock') {
      const combobox = this.bodyEl?.querySelector('stock-search-combobox') as
        (HTMLElement & { viewModel: unknown }) | null;
      if (combobox) {
        (combobox as unknown as { viewModel: unknown }).viewModel = {
          results: vm.searchResults,
          status: vm.searchStatus,
          generation: vm.searchGeneration
        };
      }
    }
    // 状态消息（pending/uncertain/error）。
    this.updateStatus(vm);
  }

  private openDialog(vm: DialogViewModel): void {
    if (!this.dialogEl || !this.controller) return;
    const returnFocus = resolveReturnFocus(vm.focusReturnId);
    // 初始焦点：优先输入框（让用户直接开始录入），其次 submit，最后 dialog 本身。
    const initialFocus = this.resolveInitialFocus(vm) ?? this.submitBtn ?? this.cancelBtn ?? this.dialogEl;
    this.controller.open(this.dialogEl, initialFocus, returnFocus);
  }

  /**
   * 根据对话框类型选择初始焦点元素：
   * add-stock → 搜索输入框；create/rename-group → 名称输入框；其余 → null（回落 submit）。
   */
  private resolveInitialFocus(vm: DialogViewModel): HTMLElement | null {
    if (!this.bodyEl) return null;
    switch (vm.kind) {
      case 'add-stock':
        return this.bodyEl.querySelector('.combobox-input') as HTMLInputElement | null;
      case 'create-group':
      case 'rename-group':
        return this.bodyEl.querySelector('input[data-field="name"]') as HTMLInputElement | null;
      default:
        return null;
    }
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

    // 标记当前 kind，供增量更新判定。
    this.renderedKind = vm.kind;

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

    // 搜索 combobox（选中后自动填充 code/name，无需手动录入）
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

    // code / name inputs（由 combobox 的 stock-search-select 自动填充）。
    // 视觉隐藏但保留在 DOM 里：Playwright fill 与表单读取都还要用。
    // 样式走 .visually-hidden 工具类，不在组件层内联复制一份声明。
    const codeField = this.createField('code', '股票代码', 'text', '');
    const nameField = this.createField('name', '股票名称', 'text', '');
    codeField.classList.add('visually-hidden');
    nameField.classList.add('visually-hidden');
    // 看不见的输入框必须退出 Tab 序列——否则键盘用户会从 combobox 跳进两个
    // 没有可见焦点指示的 1×1 输入框（WCAG 2.4.7），而且它们的值本来就是
    // combobox 选中后自动填的，不需要手动录入。
    for (const field of [codeField, nameField]) {
      field.querySelector('input')?.setAttribute('tabindex', '-1');
    }
    this.bodyEl.append(codeField, nameField);

    // 选中确认区：承载数据的两个输入框是隐藏的，没有这块，用户选完之后
    // 界面上没有任何地方显示「选中的是哪只」。aria-live 让读屏也能收到。
    const picked = document.createElement('p');
    picked.className = 'app-dialog-picked';
    picked.setAttribute('aria-live', 'polite');
    picked.hidden = true;
    this.bodyEl.append(picked);

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
    // 删除按钮现在常驻底部操作栏（见 buildSkeleton），这里不再往正文里塞。
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
    // pending / uncertain 禁用提交；此外必填项没填也禁用（见 updateSubmitEnabled）。
    const disableSubmit = vm.pending || vm.uncertain || !vm.open || !this.hasRequiredInput(vm);
    this.submitBtn.disabled = disableSubmit;
    this.cancelBtn.disabled = !vm.open;
    this.renderValidation(vm);

    // 删除分组只在重命名分组且允许删除时出现（g_all 永远不可删）。
    if (this.deleteBtn) {
      this.deleteBtn.hidden = !(vm.kind === 'rename-group' && vm.canDeleteGroup);
      this.deleteBtn.disabled = vm.pending || vm.uncertain || !vm.open;
    }

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
