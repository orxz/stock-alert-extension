// tests/component/app-dialog-host.test.ts
// Task 17 Step 1 — app-dialog-host 组件测试。
// 覆盖：Escape 关闭并恢复焦点、submit emit dialog-submit、cancel emit dialog-close-request、
// pending 禁用提交、uncertain 显示消息、no duplicate submit、backdrop close、重连不重复。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { DialogViewModel } from '../../src/popup/view-models.js';
import { closedDialog } from '../../src/popup/view-models.js';
import type { StockCode, GroupId } from '../../src/domain/index.js';

const G_ALL = 'g_all' as GroupId;
const G1 = 'g1' as GroupId;

function openAddDialog(overrides: Partial<DialogViewModel> = {}): DialogViewModel {
  return {
    ...closedDialog(),
    open: true,
    kind: 'add-stock',
    focusReturnId: overrides.focusReturnId ?? null,
    groups: [{ groupId: G_ALL, name: '全部' }, { groupId: G1, name: '分组1' }],
    ...overrides
  };
}

function openCreateGroupDialog(overrides: Partial<DialogViewModel> = {}): DialogViewModel {
  return {
    ...closedDialog(),
    open: true,
    kind: 'create-group',
    ...overrides
  };
}

function openRenameGroupDialog(overrides: Partial<DialogViewModel> = {}): DialogViewModel {
  return {
    ...closedDialog(),
    open: true,
    kind: 'rename-group',
    renameGroupId: G1,
    renameCurrentName: '分组1',
    canDeleteGroup: true,
    ...overrides
  };
}

function openMoveStocksDialog(overrides: Partial<DialogViewModel> = {}): DialogViewModel {
  return {
    ...closedDialog(),
    open: true,
    kind: 'move-stocks',
    moveCodes: ['sh600519' as StockCode, 'sz000001' as StockCode],
    moveFromGroupId: G_ALL,
    groups: [{ groupId: G1, name: '分组1' }],
    ...overrides
  };
}

function openConfirmRemoveDialog(overrides: Partial<DialogViewModel> = {}): DialogViewModel {
  return {
    ...closedDialog(),
    open: true,
    kind: 'confirm-remove',
    removeCodes: ['sh600519' as StockCode],
    removeGroupId: G_ALL,
    ...overrides
  };
}

function pressKey(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function setup(vm?: DialogViewModel): {
  el: HTMLElement & { viewModel: DialogViewModel; dialog: HTMLDialogElement | null };
  spy: PopupEventSpy;
  opener: HTMLButtonElement;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const opener = document.createElement('button');
  opener.id = 'dialog-opener';
  opener.textContent = 'Open';
  container.append(opener);
  const el = document.createElement('app-dialog-host') as HTMLElement & { viewModel: DialogViewModel; dialog: HTMLDialogElement | null };
  container.append(el);
  if (vm) el.viewModel = vm;
  return { el, spy, opener };
}

// ===== Escape closes and restores focus =====

test('Escape closes and restores focus to the opener', () => {
  const { el, opener } = setup();
  opener.focus();
  el.viewModel = openAddDialog({ focusReturnId: opener.id });
  const dialog = el.dialog!;
  assert.equal(dialog.open, true);
  pressKey(dialog, 'Escape');
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, opener);
});

// ===== Cancel button emits dialog-close-request =====

test('cancel button emits dialog-close-request with reason cancel', () => {
  const { spy } = setup(openAddDialog());
  spy.reset();
  const cancelBtn = document.querySelector('button[data-action="dialog-cancel"]') as HTMLButtonElement;
  cancelBtn.click();
  const evt = spy.lastEvent('dialog-close-request');
  assert.ok(evt);
  assert.equal(evt!.detail.reason, 'cancel');
});

// ===== Backdrop click emits dialog-close-request =====

test('backdrop click emits dialog-close-request with reason backdrop', () => {
  const { el, spy } = setup(openAddDialog());
  spy.reset();
  const dialog = el.dialog!;
  dialog.click(); // click on dialog itself (backdrop)
  const evt = spy.lastEvent('dialog-close-request');
  assert.ok(evt);
  assert.equal(evt!.detail.reason, 'backdrop');
});

// ===== Submit variants =====

/** 写入字段并派发 input——真实用户与 Playwright fill() 都会派发，
 *  「确定」的可用性正是靠它重算的。直接赋值 .value 不触发任何事件。 */
function fillField(field: string, value: string): HTMLInputElement {
  const input = document.querySelector(`input[data-field="${field}"]`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
}

test('add-stock submit emits dialog-submit with code/name/groupIds', () => {
  const { spy } = setup(openAddDialog());
  spy.reset();
  // Fill in code and name
  fillField('code', 'sh600519');
  fillField('name', '贵州茅台');
  // Check a group
  const checkboxes = document.querySelectorAll('input[data-group-id]');
  (checkboxes[0] as HTMLInputElement).checked = true;
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  submitBtn.click();
  const evt = spy.lastEvent('dialog-submit');
  assert.ok(evt);
  assert.equal(evt!.detail.kind, 'add-stock');
  assert.equal(evt!.detail.code, 'sh600519');
  assert.equal(evt!.detail.name, '贵州茅台');
});

test('create-group submit emits dialog-submit with name', () => {
  const { spy } = setup(openCreateGroupDialog());
  spy.reset();
  fillField('name', '我的分组');
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  submitBtn.click();
  const evt = spy.lastEvent('dialog-submit');
  assert.ok(evt);
  assert.equal(evt!.detail.kind, 'create-group');
  assert.equal(evt!.detail.name, '我的分组');
});

test('rename-group submit emits dialog-submit with groupId and name', () => {
  const { spy } = setup(openRenameGroupDialog());
  spy.reset();
  const nameInput = document.querySelector('input[data-field="name"]') as HTMLInputElement;
  nameInput.value = '新名称';
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  submitBtn.click();
  const evt = spy.lastEvent('dialog-submit');
  assert.ok(evt);
  assert.equal(evt!.detail.kind, 'rename-group');
  assert.equal(evt!.detail.groupId, G1);
  assert.equal(evt!.detail.name, '新名称');
});

test('rename-group delete button emits dialog-submit with delete-group', () => {
  const { spy } = setup(openRenameGroupDialog());
  spy.reset();
  const deleteBtn = document.querySelector('button[data-action="dialog-delete-group"]') as HTMLButtonElement;
  assert.ok(deleteBtn);
  deleteBtn.click();
  const evt = spy.lastEvent('dialog-submit');
  assert.ok(evt);
  assert.equal(evt!.detail.kind, 'delete-group');
  assert.equal(evt!.detail.groupId, G1);
});

test('move-stocks submit emits dialog-submit with codes and targetGroupIds', () => {
  const { spy } = setup(openMoveStocksDialog());
  spy.reset();
  const checkboxes = document.querySelectorAll('input[data-group-id]');
  (checkboxes[0] as HTMLInputElement).checked = true;
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  submitBtn.click();
  const evt = spy.lastEvent('dialog-submit');
  assert.ok(evt);
  assert.equal(evt!.detail.kind, 'move-stocks');
});

test('confirm-remove submit emits dialog-submit with remove-stocks', () => {
  const { spy } = setup(openConfirmRemoveDialog());
  spy.reset();
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  submitBtn.click();
  const evt = spy.lastEvent('dialog-submit');
  assert.ok(evt);
  assert.equal(evt!.detail.kind, 'remove-stocks');
});

// ===== Pending disables submit =====

test('pending state disables the submit button', () => {
  setup(openAddDialog({ pending: true }));
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  assert.equal(submitBtn.disabled, true);
});

// 没选股票就点「确定」原本会走到 gatherSubmitDetail 返回 null 然后什么都不发生，
// 用户得不到任何反馈。现在改成直接禁用，且选中后立刻恢复可用。
test('add-stock submit stays disabled until a stock is chosen', () => {
  setup(openAddDialog({ pending: false }));
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  assert.equal(submitBtn.disabled, true, '未选股票时必须禁用');
  fillField('code', 'sh600519');
  assert.equal(submitBtn.disabled, false, '选中后立即可用');
});

test('create-group submit stays disabled until a name is typed', () => {
  setup({ ...openAddDialog(), kind: 'create-group' });
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  assert.equal(submitBtn.disabled, true);
  fillField('name', '科技');
  assert.equal(submitBtn.disabled, false);
});

// 选中确认区：两个承载数据的输入框是视觉隐藏的，这块是唯一的可见反馈。
test('choosing a search result shows a visible confirmation', () => {
  setup(openAddDialog());
  const host = document.querySelector('app-dialog-host') as HTMLElement;
  host.dispatchEvent(new CustomEvent('stock-search-select', {
    detail: { code: 'sh600519', name: '贵州茅台' },
    bubbles: true
  }));
  const picked = document.querySelector('.app-dialog-picked') as HTMLElement;
  assert.equal(picked.hidden, false);
  assert.ok(picked.textContent?.includes('贵州茅台'));
  assert.ok(picked.textContent?.includes('sh600519'));
});

// ===== Uncertain message =====

test('uncertain state displays reconciliation message', () => {
  setup(openAddDialog({ uncertain: true }));
  const statusEl = document.querySelector('[data-region="dialog-status"]') as HTMLElement;
  assert.ok(statusEl.textContent?.includes('正在确认是否已保存'));
});

// ===== Error message =====

test('error state displays error message', () => {
  setup(openAddDialog({ errorMessage: '保存失败，请重试' }));
  const statusEl = document.querySelector('[data-region="dialog-status"]') as HTMLElement;
  assert.ok(statusEl.textContent?.includes('保存失败，请重试'));
});

// ===== No duplicate submit =====

test('no duplicate submit: second click does not emit again', () => {
  const { spy } = setup(openAddDialog());
  spy.reset();
  fillField('code', 'sh600519');
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  submitBtn.click();
  submitBtn.click();
  submitBtn.click();
  assert.equal(spy.eventCount('dialog-submit'), 1);
});

// ===== Close via VM =====

test('setting viewModel open=false closes the dialog', () => {
  const { el } = setup(openAddDialog());
  assert.equal(el.dialog!.open, true);
  el.viewModel = closedDialog();
  assert.equal(el.dialog!.open, false);
});

// ===== Incremental update: kind unchanged does NOT rebuild body =====

test('same-kind VM update preserves the combobox DOM node (no focus loss)', () => {
  const { el } = setup(openAddDialog({ searchResults: [] }));
  const comboboxBefore = document.querySelector('stock-search-combobox');
  // Update search results while dialog is open — must not destroy the combobox.
  el.viewModel = openAddDialog({ searchResults: [{ code: 'sh600519' as StockCode, name: '贵州茅台' }] });
  const comboboxAfter = document.querySelector('stock-search-combobox');
  assert.equal(comboboxAfter, comboboxBefore, 'combobox node identity must be preserved');
});

test('kind change rebuilds the body structure', () => {
  const { el } = setup(openAddDialog());
  assert.ok(document.querySelector('.combobox-input'));
  // Switch from add-stock to create-group — body must be rebuilt.
  el.viewModel = openCreateGroupDialog();
  assert.equal(document.querySelector('.combobox-input'), null, 'combobox must be removed on kind change');
  assert.ok(document.querySelector('#dialog-field-name'), 'name input must exist after rebuild');
});

// ===== Reconnect safety =====

test('reconnecting does not duplicate listeners', () => {
  const { spy, el } = setup(openAddDialog());
  el.remove();
  document.body.querySelector('div')?.append(el);
  spy.reset();
  const cancelBtn = document.querySelector('button[data-action="dialog-cancel"]') as HTMLButtonElement;
  cancelBtn.click();
  assert.equal(spy.eventCount('dialog-close-request'), 1);
});

// ===== Dialog title correctness =====

test('dialog title matches the kind', () => {
  setup(openAddDialog());
  const title = document.querySelector('[data-region="dialog-title"]') as HTMLElement;
  assert.equal(title.textContent, '添加股票');
});

// ===== Combobox inside add-stock dialog =====

test('add-stock dialog contains a search combobox', () => {
  setup(openAddDialog());
  const combobox = document.querySelector('stock-search-combobox');
  assert.ok(combobox);
});

// ===== Initial focus lands on the primary input (not submit) =====
// happy-dom 在 showModal() 打开时 document.activeElement 不可靠（返回 BODY 且
// 在 node:test 下访问会导致事件循环挂起），因此用 focus spy 捕获实际被聚焦的元素。

function withFocusSpy<T>(fn: (getLastFocused: () => HTMLElement | null) => T): T {
  let lastFocused: HTMLElement | null = null;
  const proto = HTMLElement.prototype;
  const orig = proto.focus;
  proto.focus = function (this: HTMLElement) { lastFocused = this; orig.call(this); };
  try {
    return fn(() => lastFocused);
  } finally {
    proto.focus = orig;
  }
}

test('add-stock dialog focuses the search combobox input on open', () => {
  withFocusSpy((getFocus) => {
    setup(openAddDialog());
    const comboboxInput = document.querySelector('.combobox-input') as HTMLInputElement;
    assert.equal(getFocus(), comboboxInput);
  });
});

test('create-group dialog focuses the name input on open', () => {
  withFocusSpy((getFocus) => {
    setup(openCreateGroupDialog());
    const nameInput = document.querySelector('#dialog-field-name') as HTMLInputElement;
    assert.equal(getFocus(), nameInput);
  });
});

test('confirm-remove dialog keeps focus on the submit button (no regression)', () => {
  withFocusSpy((getFocus) => {
    setup(openConfirmRemoveDialog());
    const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
    assert.equal(getFocus(), submitBtn);
  });
});

// ===== stock-search-select fills code/name =====

test('stock-search-select fills code and name inputs', () => {
  setup(openAddDialog());
  const combobox = document.querySelector('stock-search-combobox') as HTMLElement;
  combobox.dispatchEvent(new CustomEvent('stock-search-select', {
    detail: { code: 'sh600519', name: '贵州茅台' },
    bubbles: true
  }));
  const codeInput = document.querySelector('input[data-field="code"]') as HTMLInputElement;
  const nameInput = document.querySelector('input[data-field="name"]') as HTMLInputElement;
  assert.equal(codeInput.value, 'sh600519');
  assert.equal(nameInput.value, '贵州茅台');
});

// ===== confirm-remove submit button is danger styled =====

test('confirm-remove submit button text is 确认移除', () => {
  setup(openConfirmRemoveDialog());
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  assert.equal(submitBtn.textContent, '确认移除');
});

// ===== 分组重名：输入即反馈 =====
// 命令层是硬校验，但只靠它的话，用户要点完「确定」、等对话框关掉，
// 才能从 toast 里知道撞名了。这里把反馈提前到输入的那一刻。

test('create-group blocks and explains a duplicate name', () => {
  setup(openCreateGroupDialog({ groups: [{ groupId: G_ALL, name: '全部' }, { groupId: G1, name: '科技' }] }));
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  const validation = document.querySelector('[data-region="dialog-validation"]') as HTMLElement;

  fillField('name', '科技');
  assert.equal(submitBtn.disabled, true, '重名时必须禁用确定');
  assert.equal(validation.hidden, false);
  assert.ok(validation.textContent?.includes('科技'));

  fillField('name', '科技股');
  assert.equal(submitBtn.disabled, false, '改成不重复的名字后恢复可用');
  assert.equal(validation.hidden, true);
});

// 归一化后比较：「 科技 」与「科技」是同一个名字。
test('duplicate detection ignores surrounding whitespace', () => {
  setup(openCreateGroupDialog({ groups: [{ groupId: G1, name: '科技' }] }));
  fillField('name', '  科技  ');
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  assert.equal(submitBtn.disabled, true);
});

// 重命名时排除自己，否则原样保存会被判成重名。
test('rename-group allows the group to keep its own name', () => {
  setup(openRenameGroupDialog({ groups: [{ groupId: G_ALL, name: '全部' }, { groupId: G1, name: '分组1' }] }));
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  assert.equal(submitBtn.disabled, false, '预填的自身名称不算重名');
  fillField('name', '全部');
  assert.equal(submitBtn.disabled, true, '撞上别的分组才算重名');
});

// ===== 删除分组：位置在底部操作栏，且只在重命名分组时出现 =====

test('delete-group button lives in the dialog footer, not the body', () => {
  setup(openRenameGroupDialog());
  const del = document.querySelector('button[data-action="dialog-delete-group"]') as HTMLElement;
  assert.ok(del, '删除按钮存在');
  assert.ok(
    del.closest('[data-region="dialog-actions"]'),
    '必须位于底部操作栏——放在正文里紧挨着名称输入框，误触风险高'
  );
  assert.equal(del.hidden, false);
});

test('delete-group button is hidden for dialogs that cannot delete', () => {
  setup(openRenameGroupDialog({ canDeleteGroup: false }));
  const del = document.querySelector('button[data-action="dialog-delete-group"]') as HTMLElement;
  assert.equal(del.hidden, true);

  setup(openAddDialog());
  const delOnAdd = document.querySelector('button[data-action="dialog-delete-group"]') as HTMLElement;
  assert.equal(delOnAdd.hidden, true, '添加股票对话框不该出现删除分组');
});
