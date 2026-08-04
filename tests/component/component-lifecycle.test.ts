// tests/component/component-lifecycle.test.ts
// Task 14 Step 1/5 — 无基类生命周期安全：per-connection AbortController。
// 断言：重连（remove + re-append）不会复制监听器；断开后旧监听器被 abort 移除。
// 这是 brief Step 1 逐字测试目标：「reconnecting a component does not duplicate listeners」。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mock } from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';

test('reconnecting a component does not duplicate listeners', () => {
  resetDom();
  definePopupElements();
  const onRefresh = mock.fn(() => {});
  const element = document.createElement('stock-app') as HTMLElement & {
    onRefreshRequest?: () => void;
  };
  element.onRefreshRequest = onRefresh;
  document.body.append(element); // connect #1：创建 controller A，注册监听器 A
  element.remove(); // disconnect #1：abort controller A，移除监听器 A
  document.body.append(element); // connect #2：创建 controller B，注册监听器 B
  element.dispatchEvent(new CustomEvent('quote-refresh-request', { bubbles: true }));

  // 仅 controller B 的监听器存活 → 回调恰好触发一次。
  // 若未在重连时 abort 旧 controller，监听器 A 仍存活，计数将为 2。
  assert.equal(onRefresh.mock.callCount(), 1);
});

test('disconnecting a component removes its listeners (abort clears them)', () => {
  resetDom();
  definePopupElements();
  const onRefresh = mock.fn(() => {});
  const element = document.createElement('stock-app') as HTMLElement & {
    onRefreshRequest?: () => void;
  };
  element.onRefreshRequest = onRefresh;
  document.body.append(element);
  element.dispatchEvent(new CustomEvent('quote-refresh-request', { bubbles: true }));
  assert.equal(onRefresh.mock.callCount(), 1);

  element.remove(); // disconnect：abort controller，移除监听器
  // 元素已脱离文档；即便重新派发，回调不应再被触发。
  element.dispatchEvent(new CustomEvent('quote-refresh-request', { bubbles: true }));
  assert.equal(onRefresh.mock.callCount(), 1);
});

test('app-live-region updates textContent from its view model', () => {
  resetDom();
  definePopupElements();
  const el = document.createElement('app-live-region') as HTMLElement & {
    viewModel: { message: string; kind: 'info' | 'success' | 'error' | 'none' };
  };
  document.body.append(el);
  el.viewModel = { message: '已更新', kind: 'success' };
  assert.ok((el.textContent ?? '').includes('已更新'));

  el.viewModel = { message: '', kind: 'none' };
  // 清空后不再包含旧文案。
  assert.ok(!(el.textContent ?? '').includes('已更新'));
});

test('app-live-region exposes an aria-live polite region for screen readers', () => {
  resetDom();
  definePopupElements();
  const el = document.createElement('app-live-region') as HTMLElement & {
    viewModel: { message: string; kind: 'info' | 'success' | 'error' | 'none' };
  };
  document.body.append(el);
  const live = el.querySelector('[aria-live]') ?? el;
  assert.equal((live as Element).getAttribute('aria-live'), 'polite');
});
