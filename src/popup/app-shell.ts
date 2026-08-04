// src/popup/app-shell.ts
// Task 14+17+18 — Popup 应用外壳：连接 Store + CommandController + DOM 根元素。
// 职责：监听 PopupEventMap 语义事件 → 调用 Store dispatch / CommandController；
// 监听 Store 变化 → 渲染 AppViewModel（含 DialogViewModel）到 stock-app + dialog-host + live-region。
// 渲染失败时安全降级到 fallback。destroy 幂等。
import type { Store } from './store/store.js';
import type { CommandController } from './commands/command-controller.js';
import { selectAppViewModel } from './store/selectors.js';
import type { AppViewModel, DialogViewModel, LiveRegionViewModel } from './view-models.js';
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
  const liveRegion = deps.liveRegion;
  let destroyed = false;
  const ac = new AbortController();

  function renderAppSafely(): void {
    try {
      const state = store.getState();
      // Bootstrap 失败时直接显示 static fallback（用户可 reload 重试）。
      if (state.async.bootstrap.status === 'error') {
        stockApp.hidden = true;
        fallback.hidden = false;
        return;
      }
      const vm = selectAppViewModel(state);
      (stockApp as HTMLElement & { viewModel: AppViewModel }).viewModel = vm;
      stockApp.hidden = false;
      fallback.hidden = true;
      // 渲染对话框 VM 到 dialog-host（如果在 DOM 中）。
      if (dialogHost) {
        (dialogHost as HTMLElement & { viewModel: DialogViewModel }).viewModel = vm.dialog;
      }
      // 渲染 live-region VM。
      if (liveRegion) {
        (liveRegion as HTMLElement & { viewModel: LiveRegionViewModel }).viewModel = vm.liveRegion;
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
    const listener = ((event: Event) => {
      const ce = event as CustomEvent<PopupEventMap[K]>;
      if (ce.detail !== undefined) handler(ce.detail);
    }) as EventListener;
    root.addEventListener(type, listener, { signal: ac.signal });
    // dialog-host 是 stock-app 的兄弟元素，其内部事件（dialog-submit 等）
    // 需要在此元素上也注册监听器。
    if (dialogHost) dialogHost.addEventListener(type, listener, { signal: ac.signal });
  }

  // ===== 导航/视图事件 =====

  on('group-select', (d) => {
    store.dispatch({ type: 'view/currentGroup', groupId: d.groupId });
  });

  on('group-order-request', (d) => {
    void controller.setGroupOrder(d.orderedGroupIds);
  });

  on('view-mode-change', (d) => {
    void controller.patchPreferences({
      groupId: store.getState().view.currentGroupId,
      patch: { viewMode: d.viewMode }
    });
  });

  on('selection-mode-change', (d) => {
    store.dispatch({ type: 'view/selectionMode', enabled: d.enabled });
  });

  on('stock-toggle-select', (d) => {
    const state = store.getState();
    if (!state.view.selectionMode) return;
    const codes = state.view.selectedCodes;
    const newCodes = codes.includes(d.code)
      ? codes.filter((c) => c !== d.code)
      : [...codes, d.code];
    store.dispatch({ type: 'view/selection', codes: newCodes });
  });

  // column-panel-open-request: 列设置功能尚未完整接线（ColumnPanelElement 已注册但未接入 AppViewModel）。
  // 暂不处理此事件，避免打开错误的对话框。待列设置功能完成后在此接入 overlay 路径。

  // ===== 行情事件 =====

  on('quote-refresh-request', () => {
    const codes = store.getState().domain.userData.watchlist.map((s) => s.code);
    void controller.refreshQuotes(codes, true).then(() => {
      const quotes = store.getState().domain.quotes;
      // fresh===0 说明所有 provider 都失败了，仅返回了缓存或 missing。
      if (quotes.counts.fresh === 0) {
        store.dispatch({
          type: 'overlay/toast',
          toast: { message: '已保留缓存', kind: 'info' }
        });
      } else {
        store.dispatch({
          type: 'overlay/toast',
          toast: { message: '已更新', kind: 'success' }
        });
      }
    });
  });

  // ===== 股票操作事件 =====

  on('stock-pin-request', (d) => {
    void controller.setPinned({
      groupId: store.getState().view.currentGroupId,
      code: d.code,
      pinned: d.pinned,
      orderedCodes: d.orderedCodes
    });
  });

  on('stock-order-request', (d) => {
    void controller.setOrder({ groupId: d.groupId, orderedCodes: d.orderedCodes });
  });

  on('stock-remove-request', (d) => {
    void controller.removeStocks({ codes: d.codes, groupId: d.groupId });
  });

  on('batch-move-request', (d) => {
    void controller.moveStocks({
      codes: d.codes,
      fromGroupId: d.fromGroupId,
      targetGroupIds: d.targetGroupIds
    });
  });

  // ===== 偏好/搜索事件 =====

  on('preferences-change', (d) => {
    void controller.patchPreferences({
      groupId: store.getState().view.currentGroupId,
      patch: d.patch
    });
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
      ac.abort();
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
function routeDialogSubmit(d: DialogSubmitDetail, controller: CommandController, _store: Store): void {
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
