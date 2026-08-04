// src/popup/a11y/dialog-controller.ts
// Task 17 Step 3 — 原生 <dialog> 控制器。
// 管理 showModal()、native cancel 处理、keydown 焦点循环、stored return focus。
// close 恢复焦点（如果 opener 仍连接在 DOM 中）。
// 关闭路径（submit / cancel / escape）始终只触发一次 onClose 回调。
import { trapFocus } from './focus.js';

/** brief Step 3 逐字接口。 */
export interface DialogController {
  open(dialog: HTMLDialogElement, initialFocus: HTMLElement, returnFocus: HTMLElement | null): void;
  close(reason: 'submit' | 'cancel' | 'escape'): void;
  destroy(): void;
}

/** 关闭原因回调类型。 */
export type DialogCloseHandler = (reason: 'submit' | 'cancel' | 'escape') => void;

/**
 * 创建一个 DialogController。
 * @param onClose 每次 close 时触发一次（submit/cancel/escape）。
 */
export function createDialogController(onClose: DialogCloseHandler): DialogController {
  let dialogEl: HTMLDialogElement | null = null;
  let returnFocusEl: HTMLElement | null = null;
  let closed = false; // 防止重复 close

  // 存储监听器引用以便 destroy / close 时精确移除。
  let keydownListener: ((e: KeyboardEvent) => void) | null = null;
  let cancelListener: ((e: Event) => void) | null = null;

  function open(dialog: HTMLDialogElement, initialFocus: HTMLElement, returnFocus: HTMLElement | null): void {
    // 如果已有打开的 dialog，先静默关闭（不触发 onClose）。
    if (dialogEl && dialogEl.open) {
      detachListeners(dialogEl);
      dialogEl.close();
    }
    dialogEl = dialog;
    returnFocusEl = returnFocus;
    closed = false;

    dialog.showModal();
    initialFocus.focus();

    keydownListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close('escape');
        return;
      }
      if (e.key === 'Tab') {
        trapFocus(dialog, e);
      }
    };

    cancelListener = (e: Event) => {
      // 浏览器原生 cancel（ESC）——阻止默认关闭，由我们的 close 统一处理。
      e.preventDefault();
      close('escape');
    };

    dialog.addEventListener('keydown', keydownListener);
    dialog.addEventListener('cancel', cancelListener);
  }

  function close(reason: 'submit' | 'cancel' | 'escape'): void {
    if (!dialogEl || closed) return;
    closed = true;
    const d = dialogEl;
    detachListeners(d);
    if (d.open) d.close();

    // 恢复焦点：仅当 returnFocus 仍连接在 DOM 中。
    if (returnFocusEl && returnFocusEl.isConnected) {
      returnFocusEl.focus();
    }
    returnFocusEl = null;
    dialogEl = null;
    onClose(reason);
  }

  function detachListeners(d: HTMLDialogElement): void {
    if (keydownListener) {
      d.removeEventListener('keydown', keydownListener);
      keydownListener = null;
    }
    if (cancelListener) {
      d.removeEventListener('cancel', cancelListener);
      cancelListener = null;
    }
  }

  function destroy(): void {
    if (dialogEl) {
      detachListeners(dialogEl);
      if (dialogEl.open) dialogEl.close();
    }
    dialogEl = null;
    returnFocusEl = null;
    closed = false;
    keydownListener = null;
    cancelListener = null;
  }

  return { open, close, destroy };
}
