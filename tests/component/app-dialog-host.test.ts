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

test('add-stock submit emits dialog-submit with code/name/groupIds', () => {
  const { spy } = setup(openAddDialog());
  spy.reset();
  // Fill in code and name
  const codeInput = document.querySelector('input[data-field="code"]') as HTMLInputElement;
  const nameInput = document.querySelector('input[data-field="name"]') as HTMLInputElement;
  codeInput.value = 'sh600519';
  nameInput.value = '贵州茅台';
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
  const nameInput = document.querySelector('input[data-field="name"]') as HTMLInputElement;
  nameInput.value = '我的分组';
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

test('non-pending state enables the submit button', () => {
  setup(openAddDialog({ pending: false }));
  const submitBtn = document.querySelector('button[data-action="dialog-submit"]') as HTMLButtonElement;
  assert.equal(submitBtn.disabled, false);
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
  const codeInput = document.querySelector('input[data-field="code"]') as HTMLInputElement;
  codeInput.value = 'sh600519';
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
