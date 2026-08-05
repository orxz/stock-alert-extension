// tests/component/component-lifecycle.test.ts
// Task 14+18 — 无基类生命周期安全：per-connection AbortController。
// 断言：重连（remove + re-append）不会复制监听器；断开后旧监听器被 abort 移除。
// 使用 stock-header 组件验证（拥有 click 事件监听器 + per-connection AbortController）。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { HeaderViewModel } from '../../src/popup/view-models.js';
import type { BoardViewModel } from '../../src/popup/view-models.js';
import type { GroupId } from '../../src/domain/index.js';

function makeHeaderVm(): HeaderViewModel {
  return { groupName: '全部', stockCount: 0, selectionMode: false, priceHidden: false, canAddStock: true, theme: 'dark' };
}

test('reconnecting a component does not duplicate listeners', () => {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spyEvents: string[] = [];

  const el = document.createElement('stock-header') as HTMLElement & { viewModel: HeaderViewModel };
  container.append(el); // connect #1：创建 controller A，注册监听器 A
  el.viewModel = makeHeaderVm();

  // Listen for dialog-open-request on the container (bubbled from stock-header)
  container.addEventListener('dialog-open-request', () => spyEvents.push('open'));

  // Click the add button → should fire dialog-open-request
  const addBtn = el.querySelector<HTMLButtonElement>('[data-action="add-stock"]');
  assert.ok(addBtn);
  addBtn!.click();
  assert.equal(spyEvents.length, 1, 'first click fires once');

  el.remove(); // disconnect #1：abort controller A，移除监听器 A
  document.body.append(el); // reconnect — but we need it in the same container
  container.append(el);
  el.viewModel = makeHeaderVm();

  // After reconnect, get the new add button
  const addBtn2 = el.querySelector<HTMLButtonElement>('[data-action="add-stock"]');
  assert.ok(addBtn2);
  addBtn2!.click();
  // Only one listener should fire (the new one from controller B)
  assert.equal(spyEvents.length, 2, 'second click fires exactly once more');
});

test('disconnecting a component removes its listeners (abort clears them)', () => {
  resetDom();
  definePopupElements();
  const el = document.createElement('stock-header') as HTMLElement & { viewModel: HeaderViewModel };
  document.body.append(el);
  el.viewModel = makeHeaderVm();

  let clickCount = 0;
  el.addEventListener('dialog-open-request', () => { clickCount++; });

  const addBtn = el.querySelector<HTMLButtonElement>('[data-action="add-stock"]');
  assert.ok(addBtn);
  addBtn!.click();
  assert.equal(clickCount, 1, 'first click fires');

  el.remove(); // disconnect：abort controller，移除监听器
  // After disconnect, internal button listeners are gone, so clicking won't emit the event
  const addBtnAfter = el.querySelector<HTMLButtonElement>('[data-action="add-stock"]');
  addBtnAfter?.click();
  assert.equal(clickCount, 1, 'no new event after disconnect');
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

test('reconnecting stock-board does not duplicate its empty CTA listener', () => {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const el = document.createElement('stock-board') as HTMLElement & { viewModel: BoardViewModel };
  container.append(el);
  el.viewModel = {
    viewMode: 'list',
    groupId: 'g_all' as GroupId,
    stocks: [],
    loading: false,
    error: null,
    empty: true,
    emptyMessage: '暂无股票'
  };

  let openCount = 0;
  container.addEventListener('dialog-open-request', () => { openCount++; });
  el.remove();
  container.append(el);
  el.querySelector<HTMLButtonElement>('[data-action="add-stock"]')?.click();
  assert.equal(openCount, 1);
});

test('disconnecting stock-board cancels a queued viewport frame', async () => {
  resetDom();
  definePopupElements();
  const el = document.createElement('stock-board') as HTMLElement & { viewModel: BoardViewModel };
  document.body.append(el);
  el.viewModel = {
    viewMode: 'list',
    groupId: 'g_all' as GroupId,
    stocks: [],
    loading: false,
    error: null,
    empty: false,
    emptyMessage: '暂无股票'
  };
  const table = el.querySelector('stock-table') as HTMLElement & {
    viewport: { scrollOffset: number; viewportExtent: number };
  };
  let updates = 0;
  let viewport = table.viewport;
  Object.defineProperty(table, 'viewport', {
    configurable: true,
    get: () => viewport,
    set: (value) => {
      updates++;
      viewport = value as { scrollOffset: number; viewportExtent: number };
    }
  });

  el.scrollTop = 96;
  el.dispatchEvent(new Event('scroll'));
  el.remove();
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  assert.equal(updates, 0);
});

test('reconnecting stock-board replaces and disconnects its ResizeObserver', async () => {
  resetDom();
  definePopupElements();
  const OriginalResizeObserver = window.ResizeObserver;
  const observers: Array<{
    disconnected: boolean;
    notify(): void;
  }> = [];

  class TestResizeObserver {
    disconnected = false;

    constructor(private readonly callback: ResizeObserverCallback) {
      observers.push(this);
    }

    observe(): void {}
    unobserve(): void {}

    disconnect(): void {
      this.disconnected = true;
    }

    notify(): void {
      if (!this.disconnected) {
        this.callback([], this as unknown as ResizeObserver);
      }
    }
  }

  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver
  });
  try {
    const container = document.createElement('div');
    document.body.append(container);
    const el = document.createElement('stock-board') as HTMLElement & { viewModel: BoardViewModel };
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 472 });
    container.append(el);
    el.viewModel = {
      viewMode: 'list',
      groupId: 'g_all' as GroupId,
      stocks: [],
      loading: false,
      error: null,
      empty: false,
      emptyMessage: '暂无股票'
    };
    assert.equal(observers.length, 1);

    el.remove();
    assert.equal(observers[0]?.disconnected, true);
    container.append(el);
    assert.equal(observers.length, 2);
    assert.equal(observers[1]?.disconnected, false);

    observers[1]?.notify();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    const table = el.querySelector('stock-table') as HTMLElement & {
      viewport: { scrollOffset: number; viewportExtent: number };
    };
    assert.equal(table.viewport.viewportExtent, 472);
  } finally {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: OriginalResizeObserver
    });
  }
});
