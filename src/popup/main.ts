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

const stockApp = document.querySelector<HTMLElement>('stock-app');
const fallback = document.getElementById('fatal-fallback');
const liveRegion = document.querySelector<HTMLElement>('app-live-region');

if (!stockApp || !fallback) throw new Error('Popup bootstrap: missing stock-app or fatal-fallback');

const shell = createAppShell({ store, controller, stockApp, fallback, liveRegion: liveRegion ?? stockApp, sink, clock });
void controller.bootstrap();
window.addEventListener('pagehide', () => shell.destroy());
