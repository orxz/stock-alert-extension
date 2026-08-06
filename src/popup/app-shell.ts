// src/popup/app-shell.ts
// Task 14+17+18 — Popup 应用外壳：连接 Store + CommandController + DOM 根元素。
// 职责：监听 PopupEventMap 语义事件 → 调用 Store dispatch / CommandController；
// 监听 Store 变化 → 渲染 AppViewModel（含 DialogViewModel）到 stock-app + dialog-host + live-region。
// 渲染失败时安全降级到 fallback。destroy 幂等。
import type { Store } from './store/store.js';
import type { CommandController } from './commands/command-controller.js';
import { selectAppViewModel, selectVisibleStocks } from './store/selectors.js';
import type { AppViewModel, DialogViewModel, LiveRegionViewModel, PopoverViewModel } from './view-models.js';
import { normalizeUiColumns, saveUiColumns } from './ui-preferences.js';
import type { WebStorageLike } from './ui-preferences.js';
import { friendlyErrorMessage } from './error-messages.js';
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
  readonly popoverHost?: HTMLElement;
  readonly sink: DiagnosticSink;
  readonly clock: { now(): number };
}

export interface AppShell {
  renderAppSafely(): void;
  destroy(): void;
}

/** 隐私模式下访问 localStorage 本身就会抛错，取一次并吞掉异常。 */
function safeLocalStorage(): WebStorageLike | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

export function createAppShell(deps: AppShellDeps): AppShell {
  const { store, controller, stockApp, fallback, sink, clock } = deps;
  const root = stockApp;
  const dialogHost = deps.dialogHost ?? null;
  const popoverHost = deps.popoverHost ?? null;
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
      // 渲染 popover VM（列设置等轻量弹层）。
      if (popoverHost) {
        (popoverHost as HTMLElement & { viewModel: PopoverViewModel }).viewModel = vm.popover;
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
    if (popoverHost) popoverHost.addEventListener(type, listener, { signal: ac.signal });
  }

  /** 仅监听 stock-app 内部的事件（排除 dialogHost/popoverHost）——用于工具栏搜索。 */
  function onRoot<K extends keyof PopupEventMap>(type: K, handler: (detail: PopupEventMap[K]) => void): void {
    const listener = ((event: Event) => {
      const ce = event as CustomEvent<PopupEventMap[K]>;
      if (ce.detail !== undefined) handler(ce.detail);
    }) as EventListener;
    root.addEventListener(type, listener, { signal: ac.signal });
  }

  /** 仅监听 dialog-host 内部的事件——用于对话框内搜索（独立于工具栏）。 */
  function onDialog<K extends keyof PopupEventMap>(type: K, handler: (detail: PopupEventMap[K]) => void): void {
    const listener = ((event: Event) => {
      const ce = event as CustomEvent<PopupEventMap[K]>;
      if (ce.detail !== undefined) handler(ce.detail);
    }) as EventListener;
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
  on('theme-change', (d) => {
    store.dispatch({ type: 'view/theme', theme: d.theme });
    try { localStorage.setItem('uiTheme', d.theme); } catch { /* 隐私模式 */ }
    document.documentElement.dataset.theme = d.theme;
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

  on('batch-select-all', () => {
    const state = store.getState();
    if (!state.view.selectionMode) return;
    const visibleStocks = selectVisibleStocks(state);
    const allCodes = visibleStocks.map((vm) => vm.code);
    const selectedSet = new Set(state.view.selectedCodes);
    const allSelected = allCodes.length > 0 && allCodes.every((c) => selectedSet.has(c));
    // 全选 → 选中所有可见；已全选 → 取消全选（清空）。
    store.dispatch({ type: 'view/selection', codes: allSelected ? [] : allCodes });
  });

  // ===== 列设置弹层 =====

  on('column-panel-open-request', (d) => {
    store.dispatch({
      type: 'overlay/menu',
      menu: { kind: 'column-settings', anchorId: d.anchorId }
    });
  });

  on('popover-close-request', () => {
    store.dispatch({ type: 'overlay/menu', menu: null });
  });

  on('stock-menu-open-request', (d) => {
    store.dispatch({
      type: 'overlay/menu',
      menu: { kind: 'stock-actions', anchorId: d.anchorId, code: d.code }
    });
  });

  on('stock-remove-confirm-request', (d) => {
    // 删除自选股不可撤销——先关菜单，再打确认对话框，绝不即时删除。
    // 对话框关闭后焦点回到打开菜单的那个触发器。
    const anchorId = store.getState().overlay.menu?.anchorId ?? null;
    store.dispatch({ type: 'overlay/menu', menu: null });
    store.dispatch({ type: 'overlay/focusReturn', id: anchorId });
    store.dispatch({
      type: 'overlay/dialog',
      dialog: { kind: 'confirm-remove', codes: [d.code], groupId: d.groupId }
    });
  });

  on('column-settings-change', (d) => {
    // 组件发的是完整最终态，这里再规范化一次（防御第三方注入/旧版本残留）。
    const normalized = normalizeUiColumns(d.columns);
    store.dispatch({ type: 'view/columns', columns: normalized });
    saveUiColumns(safeLocalStorage(), normalized);
  });

  // ===== 行情事件 =====

  on('quote-refresh-request', () => {
    const codes = store.getState().domain.userData.watchlist.map((s) => s.code);
    void controller.refreshQuotes(codes, true).then(() => {
      const state = store.getState();
      const refresh = state.async.quoteRefresh;

      // 播报必须依据**本次刷新的结局**（async.quoteRefresh），不能读
      // domain.quotes.counts：quote/refresh/failed 不会重置 domain.quotes，
      // 残留的上一次成功快照会让失败的刷新播报「已更新」——伪成功。
      if (refresh.status === 'error') {
        store.dispatch({
          type: 'overlay/toast',
          toast: { message: friendlyErrorMessage(refresh.error, '刷新失败，已保留现有数据'), kind: 'error' }
        });
        return;
      }

      // 响应被 generation 判定为 stale（期间又发起了新刷新）——
      // 由后发起的那次负责播报，此处静默。
      if (refresh.status !== 'success') return;

      // fresh===0：请求成功但所有 provider 都没给出可用行情，仅缓存兜底。
      store.dispatch(
        state.domain.quotes.counts.fresh === 0
          ? { type: 'overlay/toast', toast: { message: '已保留缓存', kind: 'info' } }
          : { type: 'overlay/toast', toast: { message: '已更新', kind: 'success' } }
      );
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

  // 工具栏搜索：只监听 stock-app 内部（不包含对话框 combobox）。
  onRoot('search-keyword-change', (d) => {
    store.dispatch({ type: 'view/searchKeyword', keyword: d.keyword });
  });

  // 对话框内搜索：只监听 dialog-host 内部（stock-search-combobox 冒泡到这里）。
  // 独立于工具栏——写入 dialogSearch，不影响后台列表过滤。
  onDialog('search-keyword-change', (d) => {
    void controller.dialogSearchStocks(d.keyword);
  });

  // ===== Dialog 事件路由 =====

  on('dialog-open-request', (d) => {
    // 记录当前焦点元素 ID（用于关闭时恢复）。
    const activeId = document.activeElement?.id ?? null;
    store.dispatch({ type: 'overlay/focusReturn', id: activeId });
    // 原子重置对话框搜索：清残留关键词/结果 + 归零 async + 递增 generation
    // 作废上一次会话的在途响应（否则迟到结果会落进新开的对话框）。
    store.dispatch({ type: 'search/dialogReset' });
    // 根据 kind 从当前 state 构造完整 DialogState 上下文。
    // d.groupId 优先于 currentGroupId——右键/双击非激活标签时目标就是被点的那个分组。
    const state = store.getState();
    const dialog = buildDialogState(d.kind, state, d.groupId);
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
  state: Readonly<{ view: Readonly<{ currentGroupId: GroupId; selectedCodes: readonly StockCode[] }>; domain: Readonly<{ userData: Readonly<{ groups: ReadonlyArray<{ groupId: GroupId; name: string }> }> }> }>,
  targetGroupId?: GroupId
): DialogState {
  const currentGroupId = state.view.currentGroupId;
  const selectedCodes = state.view.selectedCodes;
  // 重命名的目标分组：调用方显式指定优先，否则回落当前分组。
  const renameGroupId = targetGroupId ?? currentGroupId;
  const groupName = state.domain.userData.groups.find((g) => g.groupId === renameGroupId)?.name ?? '';

  switch (kind) {
    case 'add-stock':
      return { kind: 'add-stock' };
    case 'create-group':
      return { kind: 'create-group' };
    case 'rename-group':
      return { kind: 'rename-group', groupId: renameGroupId, currentName: groupName };
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
