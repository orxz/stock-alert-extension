// src/popup/app-shell.ts
// Task 14+17 — Popup 应用外壳：连接 Store + CommandController + DOM 根元素。
// 职责：监听 PopupEventMap 语义事件 → 调用 Store dispatch / CommandController；
// 监听 Store 变化 → 渲染 AppViewModel（含 DialogViewModel）到 stock-app + dialog-host。
// 渲染失败时安全降级到 fallback。destroy 幂等。
import type { Store } from './store/store.js';
import type { CommandController } from './commands/command-controller.js';
import { selectAppViewModel } from './store/selectors.js';
import type { AppViewModel, DialogViewModel } from './view-models.js';
import type { PopupEventMap, DialogSubmitDetail } from './components/events.js';
import type { DialogState } from './store/state.js';
import type { GroupId, StockCode } from '../domain/index.js';

export interface DiagnosticSink {
  emit(event: { readonly timestamp: number; readonly scope: string; readonly type: string; readonly outcome?: string; readonly errorCode?: string }): void;
}

export interface AppShellDeps {
  readonly store: Store;
  readonly controller: CommandController;
  readonly stockApp: HTMLElement;
  readonly fallback: HTMLElement;
  readonly liveRegion: HTMLElement;
  readonly dialogHost?: HTMLElement;
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
  const dialogHost = deps.dialogHost ?? null;
  let destroyed = false;

  function renderAppSafely(): void {
    try {
      const state = store.getState();
      const vm = selectAppViewModel(state);
      (stockApp as HTMLElement & { viewModel: AppViewModel }).viewModel = vm;
      stockApp.hidden = false;
      fallback.hidden = true;
      // 渲染对话框 VM 到 dialog-host（如果在 DOM 中）。
      if (dialogHost) {
        (dialogHost as HTMLElement & { viewModel: DialogViewModel }).viewModel = vm.dialog;
      }
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

  // ===== Dialog 事件路由 =====

  on('dialog-open-request', (d) => {
    // 记录当前焦点元素 ID（用于关闭时恢复）。
    const activeId = document.activeElement?.id ?? null;
    store.dispatch({ type: 'overlay/focusReturn', id: activeId });
    // 根据 kind 从当前 state 构造完整 DialogState 上下文。
    const state = store.getState();
    const dialog = buildDialogState(d.kind, state);
    store.dispatch({ type: 'overlay/dialog', dialog });
  });

  on('dialog-close-request', () => {
    store.dispatch({ type: 'overlay/dialog', dialog: null });
    store.dispatch({ type: 'overlay/focusReturn', id: null });
  });

  on('dialog-submit', (d) => {
    // 按 kind 调用对应 CommandController 方法。
    routeDialogSubmit(d, controller, store);
    // 提交后关闭对话框（mutation 异步状态由 live-region 承载）。
    store.dispatch({ type: 'overlay/dialog', dialog: null });
    store.dispatch({ type: 'overlay/focusReturn', id: null });
  });

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

/**
 * 从当前 AppState 派生完整 DialogState（补充 kind 上下文）。
 */
function buildDialogState(
  kind: 'add-stock' | 'create-group' | 'rename-group' | 'move-stocks' | 'confirm-remove',
  state: Readonly<{ view: Readonly<{ currentGroupId: GroupId; selectedCodes: readonly StockCode[] }>; domain: Readonly<{ userData: Readonly<{ groups: ReadonlyArray<{ groupId: GroupId; name: string }> }> }> }>
): DialogState {
  const currentGroupId = state.view.currentGroupId;
  const selectedCodes = state.view.selectedCodes;
  const groupName = state.domain.userData.groups.find((g) => g.groupId === currentGroupId)?.name ?? '';

  switch (kind) {
    case 'add-stock':
      return { kind: 'add-stock' };
    case 'create-group':
      return { kind: 'create-group' };
    case 'rename-group':
      return { kind: 'rename-group', groupId: currentGroupId, currentName: groupName };
    case 'move-stocks':
      return { kind: 'move-stocks', codes: selectedCodes, fromGroupId: currentGroupId };
    case 'confirm-remove':
      return { kind: 'confirm-remove', codes: selectedCodes, groupId: currentGroupId };
  }
}

/**
 * 按 dialog-submit kind 路由到对应的 CommandController 方法。
 */
function routeDialogSubmit(d: DialogSubmitDetail, controller: CommandController, store: Store): void {
  switch (d.kind) {
    case 'add-stock':
      void controller.addStock({ code: d.code, name: d.name, groupIds: d.groupIds });
      break;
    case 'create-group':
      void controller.createGroup(d.name);
      break;
    case 'rename-group':
      void controller.renameGroup(d.groupId, d.name);
      break;
    case 'delete-group':
      void controller.deleteGroup(d.groupId);
      break;
    case 'move-stocks':
      void controller.moveStocks({ codes: d.codes, fromGroupId: d.fromGroupId, targetGroupIds: d.targetGroupIds });
      break;
    case 'remove-stocks':
      void controller.removeStocks({ codes: d.codes, groupId: d.groupId });
      break;
  }
}
