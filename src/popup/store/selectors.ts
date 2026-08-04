// src/popup/store/selectors.ts
// 纯 Selector：从 AppState 派生 ViewModel。只读、无副作用、不缓存可变值。
// Selectors 是组件渲染的唯一数据来源；偏好只从 domain.boardConfig 派生（单一真相）。
import type { BoardConfig, Stock, GroupId } from '../../domain/index.js';
import { stocksForGroup, sortStocks } from '../../domain/index.js';
import type { AppState } from './state.js';
import {
  defaultBoardConfig,
  toStockCardViewModels,
  toGroupTabs
} from '../view-models.js';
import type {
  AppViewModel,
  StockCardViewModel,
  GroupTabViewModel,
  ToolbarViewModel,
  HeaderViewModel,
  BatchToolbarViewModel,
  QuoteStatusViewModel,
  LiveRegionViewModel
} from '../view-models.js';

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
  return { visible: codes.length > 0, selectedCount: codes.length, selectedCodes: codes };
}

/** 行情刷新状态视图模型。 */
export function selectQuoteStatus(state: AppState): QuoteStatusViewModel {
  const status = state.async.quoteRefresh.status;
  const message =
    status === 'loading' ? '刷新中…'
    : status === 'success' ? '已更新'
    : status === 'error' ? (state.async.quoteRefresh.error?.message ?? '刷新失败')
    : '';
  return { status, message };
}

/** 无障碍实时区域视图模型：toast 优先，否则空。 */
export function selectLiveRegion(state: AppState): LiveRegionViewModel {
  const toast = state.overlay.toast;
  if (!toast) return { message: '', kind: 'none' };
  return { message: toast.message, kind: toast.kind };
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
    stocks: selectVisibleStocks(state),
    toolbar: selectToolbar(state),
    batchToolbar: selectBatchToolbar(state),
    quoteStatus: selectQuoteStatus(state),
    liveRegion: selectLiveRegion(state)
  };
}
