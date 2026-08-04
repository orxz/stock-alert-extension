// src/popup/main.ts
// Task 18 — 生产级 Popup bootstrap。
// 定义全部 Custom Elements → 创建 RPC/Store/Controller/AppShell → bootstrap → 调度行情刷新 → pagehide 清理。
// 行情和搜索仅通过 RPC；调度使用递归 setTimeout（盘中 10s / 盘外 5min）。
import { definePopupElements } from './components/define-elements.js';
import { createStore } from './store/store.js';
import { reducer } from './store/reducer.js';
import { createInitialState } from './store/state.js';
import { CallbackRpcClient } from './rpc-client.js';
import { CommandController } from './commands/command-controller.js';
import { createAppShell } from './app-shell.js';

definePopupElements();

const sink = {
  emit(e: { readonly timestamp: number; readonly scope: string; readonly type: string; readonly outcome?: string; readonly errorCode?: string }): void {
    if (e.outcome === 'failed') console.error(`[popup] ${e.scope}/${e.type}: ${e.errorCode ?? ''}`);
  }
};
const clock = { now: () => Date.now() };

const rpc = new CallbackRpcClient((message: unknown, cb: (r: unknown) => void) => {
  chrome.runtime.sendMessage(message, cb);
});

const store = createStore(reducer, createInitialState());
const controller = new CommandController(rpc, store);

const stockApp = document.querySelector<HTMLElement>('#stock-app');
const fallback = document.getElementById('fatal-fallback');
const liveRegion = document.querySelector<HTMLElement>('#app-live-region');
const dialogHost = document.querySelector<HTMLElement>('#dialog-host');

if (!stockApp || !fallback) throw new Error('Popup bootstrap: missing #stock-app or #fatal-fallback');

const shell = createAppShell({
  store,
  controller,
  stockApp,
  fallback,
  liveRegion: liveRegion ?? stockApp,
  dialogHost: dialogHost ?? undefined,
  sink,
  clock
});

// ===== 行情刷新调度（递归 setTimeout）=====

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let destroyed = false;

/** 判断当前是否处于 A 股交易时段（简化：工作日 9:25-11:30 / 13:00-15:00 北京时间）。 */
function isMarketSession(): boolean {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false; // 周末
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const time = hours * 60 + minutes;
  // 9:25 - 11:30
  if (time >= 565 && time <= 690) return true;
  // 13:00 - 15:00
  if (time >= 780 && time <= 900) return true;
  return false;
}

function scheduleNextRefresh(): void {
  if (destroyed) return;
  const interval = isMarketSession() ? 10_000 : 300_000;
  refreshTimer = setTimeout(() => {
    if (destroyed) return;
    const codes = store.getState().domain.userData.watchlist.map((s) => s.code);
    if (codes.length > 0) {
      void controller.refreshQuotes(codes, false);
    }
    scheduleNextRefresh();
  }, interval);
}

// Bootstrap → 调度首次刷新。
void controller.bootstrap().then(() => {
  scheduleNextRefresh();
});

// pagehide → 清理全部 timer/listener。
window.addEventListener('pagehide', () => {
  destroyed = true;
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  shell.destroy();
});
