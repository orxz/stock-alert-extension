// src/popup/store/selectors.ts
// 纯 Selector：从 AppState 派生 ViewModel。只读、无副作用、不缓存可变值。
// Selectors 是组件渲染的唯一数据来源；偏好只从 domain.boardConfig 派生（单一真相）。
import type { BoardConfig, Stock, GroupId } from '../../domain/index.js';
import { stocksForGroup, sortStocks } from '../../domain/index.js';
import type { AppState } from './state.js';
import {
  defaultBoardConfig,
  toStockCardViewModels,
  toGroupTabs,
  closedDialog
} from '../view-models.js';
import type {
  AppViewModel,
  BoardViewModel,
  StockCardViewModel,
  GroupTabViewModel,
  ToolbarViewModel,
  HeaderViewModel,
  BatchToolbarViewModel,
  QuoteStatusViewModel,
  LiveRegionViewModel,
  DialogViewModel,
  DialogGroupOption
} from '../view-models.js';

/** 固定计算视图分组 ID。 */
const ALL_GROUP_ID = 'g_all' as GroupId;

/**
 * 当前看板配置：从 domain.userData.boardConfig[currentGroupId] 派生；缺省回退 defaultBoardConfig。
 * 这是 viewMode / sortField / sortDirection / priceHidden 的唯一真相来源。
 */
export function selectCurrentBoardConfig(state: AppState): BoardConfig {
  return state.domain.userData.boardConfig[state.view.currentGroupId] ?? defaultBoardConfig();
}

/** 按当前分组过滤，再按搜索关键词（代码或名称）二次过滤。 */
function filterStocks(state: AppState): readonly Stock[] {
  const stocks = stocksForGroup(state.domain.userData.watchlist, state.view.currentGroupId);
  const keyword = state.view.searchKeyword.trim().toLowerCase();
  if (!keyword) return stocks;
  return stocks.filter(
    (stock) =>
      String(stock.code).toLowerCase().includes(keyword) ||
      String(stock.name).toLowerCase().includes(keyword)
  );
}

/**
 * 可见股票卡片视图模型：filter → sort → toViewModels。
 * 价格掩码、staleLabel、pinned 均在此投影中计算。
 */
export function selectVisibleStocks(state: AppState): readonly StockCardViewModel[] {
  const config = selectCurrentBoardConfig(state);
  const groupId: GroupId = state.view.currentGroupId;
  const visible = sortStocks(filterStocks(state), state.domain.quotes, groupId, config);
  return toStockCardViewModels(visible, state.domain.quotes, config, groupId);
}

/** 看板视图模型：视图模式 + 股票列表 + 加载/空/错误状态。 */
export function selectBoard(state: AppState): BoardViewModel {
  const config = selectCurrentBoardConfig(state);
  const stocks = selectVisibleStocks(state);
  const loading = state.async.bootstrap.status === 'loading';
  const error = state.async.bootstrap.status === 'error'
    ? (state.async.bootstrap.error?.message ?? '加载失败')
    : null;
  return {
    viewMode: config.viewMode,
    groupId: state.view.currentGroupId,
    stocks,
    loading,
    error,
    empty: !loading && !error && stocks.length === 0,
    emptyMessage: '暂无股票，点击添加'
  };
}

/** 分组标签（按 order 升序，标记当前激活）。 */
export function selectGroupTabs(state: AppState): GroupTabViewModel[] {
  return toGroupTabs(state.domain.userData.groups, state.view.currentGroupId);
}

/** 顶部工具栏视图模型。 */
export function selectToolbar(state: AppState): ToolbarViewModel {
  const config = selectCurrentBoardConfig(state);
  const total = stocksForGroup(state.domain.userData.watchlist, state.view.currentGroupId).length;
  return {
    viewMode: config.viewMode,
    sortField: config.sortField,
    sortDirection: config.sortDirection,
    priceHidden: config.priceHidden,
    searchKeyword: state.view.searchKeyword,
    totalCount: total,
    hasStocks: total > 0
  };
}

/** 头部视图模型：当前分组名 + 股票数 + 按钮状态。 */
export function selectHeader(state: AppState): HeaderViewModel {
  const group = state.domain.userData.groups.find((g) => g.groupId === state.view.currentGroupId);
  const groupName = group?.name ?? '全部';
  const stockCount = stocksForGroup(state.domain.userData.watchlist, state.view.currentGroupId).length;
  const config = selectCurrentBoardConfig(state);
  return {
    groupName,
    stockCount,
    selectionMode: state.view.selectedCodes.length > 0,
    priceHidden: config.priceHidden,
    canAddStock: true
  };
}

/** 批量工具栏视图模型：选中态。 */
export function selectBatchToolbar(state: AppState): BatchToolbarViewModel {
  const codes = state.view.selectedCodes;
  return {
    visible: codes.length > 0,
    selectedCount: codes.length,
    selectedCodes: codes,
    groupId: state.view.currentGroupId
  };
}

/** 行情刷新状态视图模型。 */
export function selectQuoteStatus(state: AppState): QuoteStatusViewModel {
  const status = state.async.quoteRefresh.status;
  const message =
    status === 'loading' ? '刷新中…'
    : status === 'success' ? '已更新'
    : status === 'error' ? (state.async.quoteRefresh.error?.message ?? '刷新失败')
    : '';
  const q = state.domain.quotes;
  const lastRefreshTime = q.succeededAt ? new Date(q.succeededAt).toLocaleTimeString('zh-CN') : '';
  const deferredUntil = q.deferredUntil ? new Date(q.deferredUntil).toLocaleTimeString('zh-CN') : '';
  return {
    status,
    message,
    freshCount: q.counts.fresh,
    cachedCount: q.counts.cached,
    missingCount: q.counts.missing,
    lastRefreshTime,
    deferredUntil
  };
}

/** 无障碍实时区域视图模型：toast 优先，否则空。 */
export function selectLiveRegion(state: AppState): LiveRegionViewModel {
  const toast = state.overlay.toast;
  if (!toast) return { message: '', kind: 'none' };
  return { message: toast.message, kind: toast.kind };
}

/**
 * 对话框视图模型：从 overlay.dialog + async.mutations + view.searchResults 派生。
 * dialog=null 时返回关闭态。
 */
export function selectDialog(state: AppState): DialogViewModel {
  const dialog = state.overlay.dialog;
  if (!dialog) return closedDialog();

  // 检查是否有 pending / uncertain mutation。
  const mutationValues = Object.values(state.async.mutations);
  const pending = mutationValues.some((m) => m.status === 'pending');
  const uncertain = mutationValues.some((m) => m.status === 'uncertain');
  const failedMutation = mutationValues.find((m) => m.status === 'failed');
  const errorMessage = failedMutation?.error?.message ?? null;

  // 可用分组列表（按 order 升序）。
  const allGroups: DialogGroupOption[] = state.domain.userData.groups
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((g) => ({ groupId: g.groupId, name: g.name }));

  // 非 g_all 的分组用于 move-stocks 目标选择。
  const customGroups = allGroups.filter((g) => g.groupId !== ALL_GROUP_ID);

  const base: DialogViewModel = {
    ...closedDialog(),
    open: true,
    focusReturnId: state.overlay.focusReturnId,
    pending,
    uncertain,
    errorMessage,
    searchResults: state.view.searchResults,
    searchStatus: state.async.stockSearch.status,
    searchKeyword: state.view.searchKeyword,
    searchGeneration: state.async.searchGeneration,
    groups: []
  };

  switch (dialog.kind) {
    case 'add-stock':
      return { ...base, kind: 'add-stock', groups: allGroups };
    case 'create-group':
      return { ...base, kind: 'create-group' };
    case 'rename-group':
      return {
        ...base,
        kind: 'rename-group',
        renameGroupId: dialog.groupId,
        renameCurrentName: dialog.currentName,
        canDeleteGroup: dialog.groupId !== ALL_GROUP_ID
      };
    case 'move-stocks':
      return {
        ...base,
        kind: 'move-stocks',
        moveCodes: dialog.codes,
        moveFromGroupId: dialog.fromGroupId,
        groups: customGroups
      };
    case 'confirm-remove':
      return {
        ...base,
        kind: 'confirm-remove',
        removeCodes: dialog.codes,
        removeGroupId: dialog.groupId
      };
    default:
      return closedDialog();
  }
}

/**
 * 根 AppViewModel：聚合所有子 ViewModel，供 stock-app 根组件单次渲染（Task 14）。
 * 各子 selector 独立派生、只读；任一分支异常会向上传播（被 AppShell.renderAppSafely 捕获）。
 */
export function selectAppViewModel(state: AppState): AppViewModel {
  return {
    currentGroupId: state.view.currentGroupId,
    searchKeyword: state.view.searchKeyword,
    header: selectHeader(state),
    groupTabs: selectGroupTabs(state),
    board: selectBoard(state),
    toolbar: selectToolbar(state),
    batchToolbar: selectBatchToolbar(state),
    quoteStatus: selectQuoteStatus(state),
    liveRegion: selectLiveRegion(state),
    dialog: selectDialog(state)
  };
}
