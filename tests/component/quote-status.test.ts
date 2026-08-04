// tests/component/quote-status.test.ts
// Task 16 Step 7 — quote-status 组件测试。
// 断言：fresh/cached/missing counts、last refresh time、deferred-until text、
//       refresh button aria-busy、quote-refresh-request 事件。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { spyPopupEvents, type PopupEventSpy } from '../helpers/popup-events.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import type { QuoteStatusViewModel } from '../../src/popup/view-models.js';

function status(overrides: Partial<QuoteStatusViewModel> = {}): QuoteStatusViewModel {
  return {
    status: 'idle',
    message: '',
    freshCount: 3,
    cachedCount: 1,
    missingCount: 0,
    lastRefreshTime: '10:30:00',
    deferredUntil: '',
    ...overrides
  };
}

function setup(vm?: QuoteStatusViewModel): {
  el: HTMLElement & { viewModel: QuoteStatusViewModel };
  spy: PopupEventSpy;
} {
  resetDom();
  definePopupElements();
  const container = document.createElement('div');
  document.body.append(container);
  const spy = spyPopupEvents(container);
  const el = document.createElement('quote-status') as HTMLElement & { viewModel: QuoteStatusViewModel };
  container.append(el);
  if (vm) el.viewModel = vm;
  return { el, spy };
}

function clickRefresh(): void {
  const btn = document.querySelector('button[data-action="refresh"]') as HTMLButtonElement | null;
  if (!btn) throw new Error('refresh button not found');
  btn.click();
}

test('displays fresh count', () => {
  setup(status({ freshCount: 5 }));
  const el = document.querySelector('quote-status') as HTMLElement;
  assert.ok(el.textContent?.includes('5'));
});

test('displays cached count', () => {
  setup(status({ cachedCount: 2 }));
  const el = document.querySelector('quote-status') as HTMLElement;
  assert.ok(el.textContent?.includes('2'));
});

test('displays missing count', () => {
  setup(status({ missingCount: 1 }));
  const el = document.querySelector('quote-status') as HTMLElement;
  assert.ok(el.textContent?.includes('1'));
});

test('displays last refresh time', () => {
  setup(status({ lastRefreshTime: '14:25:30' }));
  const el = document.querySelector('quote-status') as HTMLElement;
  assert.ok(el.textContent?.includes('14:25:30'));
});

test('displays deferred-until when set', () => {
  setup(status({ deferredUntil: '14:30:00' }));
  const el = document.querySelector('quote-status') as HTMLElement;
  assert.ok(el.textContent?.includes('14:30:00'));
});

test('refresh button emits quote-refresh-request with force true', () => {
  const { spy } = setup(status());
  spy.reset();
  clickRefresh();
  assert.deepEqual(spy.lastEvent('quote-refresh-request')?.detail, { force: true });
});

test('refresh button has aria-busy false when idle', () => {
  setup(status({ status: 'idle' }));
  const btn = document.querySelector('button[data-action="refresh"]') as HTMLElement;
  assert.equal(btn.getAttribute('aria-busy'), 'false');
});

test('refresh button has aria-busy true when loading', () => {
  setup(status({ status: 'loading' }));
  const btn = document.querySelector('button[data-action="refresh"]') as HTMLElement;
  assert.equal(btn.getAttribute('aria-busy'), 'true');
});

test('refresh button has an accessible label', () => {
  setup(status());
  const btn = document.querySelector('button[data-action="refresh"]') as HTMLElement;
  const label = btn.getAttribute('aria-label') ?? '';
  assert.ok(label.length > 0);
});

test('refresh button meets 44px touch target via CSS class', () => {
  setup(status());
  const btn = document.querySelector('button[data-action="refresh"]');
  assert.ok(btn?.classList.contains('quote-status-btn'));
});

test('updating viewModel updates counts', () => {
  const { el } = setup(status({ freshCount: 1 }));
  el.viewModel = status({ freshCount: 10 });
  const statusEl = document.querySelector('quote-status') as HTMLElement;
  assert.ok(statusEl.textContent?.includes('10'));
});

test('reconnecting does not duplicate listeners', () => {
  const { el, spy } = setup(status());
  el.remove();
  document.body.querySelector('div')?.append(el);
  spy.reset();
  clickRefresh();
  assert.equal(spy.eventCount('quote-refresh-request'), 1);
});
