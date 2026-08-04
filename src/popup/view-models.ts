// src/popup/view-models.ts
// 纯数据 ViewModel：组件渲染所需的全部信息（文本 / 状态 / disabled 标志等）。
// 无方法、无副作用；由 selectors 从 AppState 派生。
import type {
  GroupId,
  StockCode,
  Stock,
  Group,
  QuoteSnapshot,
  QuoteResult,
  BoardConfig,
  ViewMode,
  SortField,
  SortDirection,
  StockSearchResult
} from '../domain/index.js';

/** 单只股票卡片视图模型。 */
export interface StockCardViewModel {
  readonly code: StockCode;
  readonly name: string;
  readonly price: number | null;
  readonly change: number | null;
  readonly changePercent: number | null;
  readonly status: 'fresh' | 'cached' | 'missing';
  readonly pinned: boolean;
  readonly staleLabel: string;
  /** priceHidden 时掩码；缺失时 '--'。 */
  readonly displayPrice: string;
}

/** 分组标签视图模型。 */
export interface GroupTabViewModel {
  readonly groupId: GroupId;
  readonly name: string;
  readonly isActive: boolean;
  readonly order: number;
}

/** 顶部工具栏视图模型。 */
export interface ToolbarViewModel {
  readonly viewMode: ViewMode;
  readonly sortField: SortField;
  readonly sortDirection: SortDirection;
  readonly priceHidden: boolean;
  readonly searchKeyword: string;
  readonly totalCount: number;
  readonly hasStocks: boolean;
}

/** 头部视图模型（当前分组名 + 计数 + 按钮状态）。 */
export interface HeaderViewModel {
  readonly groupName: string;
  readonly stockCount: number;
  readonly selectionMode: boolean;
  readonly priceHidden: boolean;
  readonly canAddStock: boolean;
}

/** 批量工具栏视图模型（选中态）。 */
export interface BatchToolbarViewModel {
  readonly visible: boolean;
  readonly selectedCount: number;
  readonly selectedCodes: readonly StockCode[];
  readonly groupId: GroupId;
}

/** 看板视图模型：视图模式 + 股票列表 + 加载/空/错误状态。 */
export interface BoardViewModel {
  readonly viewMode: ViewMode;
  readonly groupId: GroupId;
  readonly stocks: readonly StockCardViewModel[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly empty: boolean;
  readonly emptyMessage: string;
}

/** 单列配置项。 */
export interface ColumnConfig {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
}

/** 列设置面板视图模型。 */
export interface ColumnPanelViewModel {
  readonly columns: readonly ColumnConfig[];
  readonly columnOrder: readonly string[];
}

/** 行情刷新状态视图模型。 */
export interface QuoteStatusViewModel {
  readonly status: 'idle' | 'loading' | 'success' | 'error';
  readonly message: string;
  readonly freshCount: number;
  readonly cachedCount: number;
  readonly missingCount: number;
  readonly lastRefreshTime: string;
  readonly deferredUntil: string;
}

/** 无障碍实时区域视图模型（toast / 状态播报）。 */
export interface LiveRegionViewModel {
  readonly message: string;
  readonly kind: 'info' | 'success' | 'error' | 'none';
}

/** 对话框分组选项（add-stock / move-stocks 选择器用）。 */
export interface DialogGroupOption {
  readonly groupId: GroupId;
  readonly name: string;
}

/** 对话框状态种类（与 store DialogState kind 对齐）。 */
export type DialogKind = 'add-stock' | 'create-group' | 'rename-group' | 'move-stocks' | 'confirm-remove';

/**
 * 对话框视图模型：app-dialog-host 渲染所需的全部信息。
 * 当 open=false/kind=null 时表示关闭态。
 * pending/uncertain/errorMessage 反映当前 mutation 异步状态。
 */
export interface DialogViewModel {
  readonly open: boolean;
  readonly kind: DialogKind | null;
  readonly focusReturnId: string | null;
  readonly pending: boolean;
  readonly uncertain: boolean;
  readonly errorMessage: string | null;
  readonly searchResults: readonly StockSearchResult[];
  readonly searchStatus: 'idle' | 'loading' | 'success' | 'error';
  readonly searchKeyword: string;
  readonly searchGeneration: number;
  readonly renameGroupId: GroupId | null;
  readonly renameCurrentName: string;
  readonly moveCodes: readonly StockCode[];
  readonly moveFromGroupId: GroupId | null;
  readonly removeCodes: readonly StockCode[];
  readonly removeGroupId: GroupId | null;
  readonly groups: readonly DialogGroupOption[];
  readonly canDeleteGroup: boolean;
}

/** 搜索 combobox 视图模型。 */
export interface SearchComboboxViewModel {
  readonly results: readonly StockSearchResult[];
  readonly status: 'idle' | 'loading' | 'success' | 'error';
  readonly generation: number;
}

/** 关闭态 DialogViewModel（所有字段归零）。 */
export function closedDialog(): DialogViewModel {
  return {
    open: false,
    kind: null,
    focusReturnId: null,
    pending: false,
    uncertain: false,
    errorMessage: null,
    searchResults: [],
    searchStatus: 'idle',
    searchKeyword: '',
    searchGeneration: 0,
    renameGroupId: null,
    renameCurrentName: '',
    moveCodes: [],
    moveFromGroupId: null,
    removeCodes: [],
    removeGroupId: null,
    groups: [],
    canDeleteGroup: false
  };
}

/** 默认看板配置：list + manual + asc + 价格可见。 */
export function defaultBoardConfig(): BoardConfig {
  return { viewMode: 'list', sortField: 'manual', sortDirection: 'asc', priceHidden: false };
}

/** 格式化价格（两位小数）；非有限→'--'。 */
function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return '--';
  return price.toFixed(2);
}

const PRICE_MASK = '****';

/** 将排序后的股票列表投影为 StockCardViewModel 列表。 */
export function toStockCardViewModels(
  stocks: readonly Stock[],
  quotes: QuoteSnapshot,
  config: BoardConfig,
  groupId: GroupId
): StockCardViewModel[] {
  return stocks.map((stock) => {
    const result: QuoteResult | undefined = quotes.results[stock.code];
    const quote = result?.quote ?? null;
    const price = quote && Number.isFinite(quote.price) ? quote.price : null;
    const change = quote && Number.isFinite(quote.change) ? quote.change : null;
    const changePercent = quote && Number.isFinite(quote.changePercent) ? quote.changePercent : null;
    const status = result?.status ?? 'missing';
    const displayPrice = config.priceHidden ? PRICE_MASK : price === null ? '--' : formatPrice(price);
    return {
      code: stock.code,
      name: stock.name,
      price,
      change,
      changePercent,
      status,
      pinned: stock.pinned[groupId] ?? false,
      staleLabel: status === 'cached' ? '已过期' : '',
      displayPrice
    };
  });
}

/**
 * 根 AppViewModel：聚合所有子 ViewModel，供 stock-app 根组件单次渲染（Task 14）。
 * 纯数据快照——由 selectAppViewModel 从 AppState 派生；组件只读不缓存可变状态。
 */
export interface AppViewModel {
  readonly currentGroupId: GroupId;
  readonly searchKeyword: string;
  readonly header: HeaderViewModel;
  readonly groupTabs: readonly GroupTabViewModel[];
  readonly board: BoardViewModel;
  readonly toolbar: ToolbarViewModel;
  readonly batchToolbar: BatchToolbarViewModel;
  readonly quoteStatus: QuoteStatusViewModel;
  readonly liveRegion: LiveRegionViewModel;
  readonly dialog: DialogViewModel;
}

/** 将 Group 列表投影为 GroupTabViewModel 列表（按 order 升序）。 */
export function toGroupTabs(groups: readonly Group[], currentGroupId: GroupId): GroupTabViewModel[] {
  return [...groups]
    .sort((a, b) => a.order - b.order)
    .map((group) => ({
      groupId: group.groupId,
      name: group.name,
      isActive: group.groupId === currentGroupId,
      order: group.order
    }));
}
