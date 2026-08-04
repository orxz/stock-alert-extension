// tests/unit/popup/dialog-controller.test.ts
// Task 17 Step 1 — DialogController 单元测试。
// 覆盖：open/showModal/initial focus、close 恢复焦点、Tab 焦点循环、
// Escape 关闭、cancel 事件、重复 close 防护、destroy 清理。
import '../../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../../helpers/dom-environment.js';
import { createDialogController, type DialogController } from '../../../src/popup/a11y/dialog-controller.js';

function pressKey(el: HTMLElement, key: string, shiftKey = false): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, shiftKey }));
}

function createDialogWithButtons(): { dialog: HTMLDialogElement; first: HTMLButtonElement; last: HTMLButtonElement } {
  const dialog = document.createElement('dialog');
  const first = document.createElement('button');
  first.type = 'button';
  first.textContent = 'First';
  const last = document.createElement('button');
  last.type = 'button';
  last.textContent = 'Last';
  dialog.append(first, last);
  document.body.append(dialog);
  return { dialog, first, last };
}

test('open calls showModal and focuses initial focus element', () => {
  resetDom();
  const { dialog, first } = createDialogWithButtons();
  const ctrl = createDialogController(() => {});
  const opener = document.createElement('button');
  document.body.append(opener);
  ctrl.open(dialog, first, opener);
  assert.equal(dialog.open, true);
  assert.equal(document.activeElement, first);
  ctrl.destroy();
});

test('close restores focus to the return focus element', () => {
  resetDom();
  const { dialog, first } = createDialogWithButtons();
  const ctrl = createDialogController(() => {});
  const opener = document.createElement('button');
  opener.id = 'opener-1';
  document.body.append(opener);
  opener.focus();
  ctrl.open(dialog, first, opener);
  first.focus();
  ctrl.close('cancel');
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, opener);
});

test('close does not restore focus if return element is disconnected', () => {
  resetDom();
  const { dialog, first } = createDialogWithButtons();
  const ctrl = createDialogController(() => {});
  const opener = document.createElement('button');
  document.body.append(opener);
  ctrl.open(dialog, first, opener);
  opener.remove();
  ctrl.close('cancel');
  assert.equal(dialog.open, false);
});

test('Escape key triggers close with escape reason', () => {
  resetDom();
  let closeReason: string | null = null;
  const { dialog, first } = createDialogWithButtons();
  const ctrl = createDialogController((reason) => { closeReason = reason; });
  const opener = document.createElement('button');
  document.body.append(opener);
  ctrl.open(dialog, first, opener);
  pressKey(dialog, 'Escape');
  assert.equal(closeReason, 'escape');
  assert.equal(dialog.open, false);
});

test('cancel event triggers close with escape reason', () => {
  resetDom();
  let closeReason: string | null = null;
  const { dialog, first } = createDialogWithButtons();
  const ctrl = createDialogController((reason) => { closeReason = reason; });
  const opener = document.createElement('button');
  document.body.append(opener);
  ctrl.open(dialog, first, opener);
  dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }));
  assert.equal(closeReason, 'escape');
  assert.equal(dialog.open, false);
});

test('Tab on last element wraps to first', () => {
  resetDom();
  const { dialog, first, last } = createDialogWithButtons();
  const ctrl = createDialogController(() => {});
  const opener = document.createElement('button');
  document.body.append(opener);
  ctrl.open(dialog, first, opener);
  last.focus();
  assert.equal(document.activeElement, last);
  pressKey(dialog, 'Tab');
  assert.equal(document.activeElement, first, 'Tab from last should wrap to first');
  ctrl.destroy();
});

test('Shift+Tab on first element wraps to last', () => {
  resetDom();
  const { dialog, first, last } = createDialogWithButtons();
  const ctrl = createDialogController(() => {});
  const opener = document.createElement('button');
  document.body.append(opener);
  ctrl.open(dialog, first, opener);
  first.focus();
  assert.equal(document.activeElement, first);
  pressKey(dialog, 'Tab', true);
  assert.equal(document.activeElement, last, 'Shift+Tab from first should wrap to last');
  ctrl.destroy();
});

test('repeated close only triggers onClose once', () => {
  resetDom();
  let closeCount = 0;
  const { dialog, first } = createDialogWithButtons();
  const ctrl = createDialogController(() => { closeCount++; });
  const opener = document.createElement('button');
  document.body.append(opener);
  ctrl.open(dialog, first, opener);
  ctrl.close('submit');
  ctrl.close('submit');
  ctrl.close('cancel');
  assert.equal(closeCount, 1);
});

test('destroy closes dialog and cleans up listeners', () => {
  resetDom();
  let closeCount = 0;
  const { dialog, first } = createDialogWithButtons();
  const ctrl = createDialogController(() => { closeCount++; });
  const opener = document.createElement('button');
  document.body.append(opener);
  ctrl.open(dialog, first, opener);
  assert.equal(dialog.open, true);
  ctrl.destroy();
  assert.equal(dialog.open, false);
  assert.equal(closeCount, 0, 'destroy should not trigger onClose');
  // Escape after destroy should not trigger close
  pressKey(dialog, 'Escape');
  assert.equal(closeCount, 0);
});

test('close with submit reason triggers onClose with submit', () => {
  resetDom();
  let closeReason: string | null = null;
  const { dialog, first } = createDialogWithButtons();
  const ctrl = createDialogController((reason) => { closeReason = reason; });
  const opener = document.createElement('button');
  document.body.append(opener);
  ctrl.open(dialog, first, opener);
  ctrl.close('submit');
  assert.equal(closeReason, 'submit');
});

test('reopening after close works correctly', () => {
  resetDom();
  const { dialog, first } = createDialogWithButtons();
  const ctrl = createDialogController(() => {});
  const opener = document.createElement('button');
  document.body.append(opener);
  ctrl.open(dialog, first, opener);
  assert.equal(dialog.open, true);
  ctrl.close('cancel');
  assert.equal(dialog.open, false);
  ctrl.open(dialog, first, opener);
  assert.equal(dialog.open, true);
  ctrl.destroy();
});
