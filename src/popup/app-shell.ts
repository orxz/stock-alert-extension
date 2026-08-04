import type { Store } from './store/store.js';
import type { CommandController } from './commands/command-controller.js';
import { selectAppViewModel } from './store/selectors.js';
import type { AppViewModel } from './view-models.js';
import type { PopupEventMap } from './components/events.js';

export interface DiagnosticSink {
  emit(event: { readonly timestamp: number; readonly scope: string; readonly type: string; readonly outcome?: string; readonly errorCode?: string }): void;
}

export interface AppShellDeps {
  readonly store: Store;
  readonly controller: CommandController;
  readonly stockApp: HTMLElement;
  readonly fallback: HTMLElement;
  readonly liveRegion: HTMLElement;
  readonly sink: DiagnosticSink;
  readonly clock: { now(): number };
}

export interface AppShell {
  renderAppSafely(): void;
  destroy(): void;
}

export function createAppShell(deps: AppShellDeps): AppShell {
  const { store, controller, stockApp, fallback, sink, clock } = deps;
  const root = stockApp;
  let destroyed = false;

  function renderAppSafely(): void {
    try {
      const state = store.getState();
      const vm = selectAppViewModel(state);
      (stockApp as HTMLElement & { viewModel: AppViewModel }).viewModel = vm;
      stockApp.hidden = false;
      fallback.hidden = true;
    } catch (error) {
      sink.emit({
        timestamp: clock.now(),
        scope: 'ui',
        type: 'render-failed',
        outcome: 'failed',
        errorCode: error instanceof Error ? error.message : 'unknown'
      });
      stockApp.hidden = true;
      fallback.hidden = false;
    }
  }

  function on<K extends keyof PopupEventMap>(type: K, handler: (detail: PopupEventMap[K]) => void): void {
    root.addEventListener(type, ((event: Event) => {
      const ce = event as CustomEvent<PopupEventMap[K]>;
      if (ce.detail !== undefined) handler(ce.detail);
    }) as EventListener);
  }

  on('group-select', (d) => store.dispatch({ type: 'view/currentGroup', groupId: d.groupId }));
  on('quote-refresh-request', () => {
    const codes = store.getState().domain.userData.watchlist.map((s) => s.code);
    void controller.refreshQuotes(codes, true);
  });
  on('stock-pin-request', (d) => {
    void controller.setPinned({ groupId: store.getState().view.currentGroupId, code: d.code, pinned: d.pinned, orderedCodes: d.orderedCodes });
  });
  on('stock-order-request', (d) => {
    void controller.setOrder({ groupId: d.groupId, orderedCodes: d.orderedCodes });
  });
  on('stock-remove-request', (d) => {
    void controller.removeStocks({ codes: d.codes, groupId: d.groupId });
  });
  on('preferences-change', (d) => {
    void controller.patchPreferences({ groupId: store.getState().view.currentGroupId, patch: d.patch });
  });
  on('search-keyword-change', (d) => {
    store.dispatch({ type: 'view/searchKeyword', keyword: d.keyword });
    void controller.searchStocks(d.keyword);
  });
  on('dialog-open-request', (d) => store.dispatch({ type: 'overlay/dialog', dialog: { kind: d.kind } as never }));
  on('dialog-close-request', () => store.dispatch({ type: 'overlay/dialog', dialog: null }));

  const unsubscribe = store.subscribe(renderAppSafely);
  document.querySelector('#btn-reload')?.addEventListener('click', () => location.reload());
  renderAppSafely();

  return {
    renderAppSafely,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
    }
  };
}
