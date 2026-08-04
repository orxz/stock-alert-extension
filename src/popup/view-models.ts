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
  SortDirection
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
}

/** 行情刷新状态视图模型。 */
export interface QuoteStatusViewModel {
  readonly status: 'idle' | 'loading' | 'success' | 'error';
  readonly message: string;
}

/** 无障碍实时区域视图模型（toast / 状态播报）。 */
export interface LiveRegionViewModel {
  readonly message: string;
  readonly kind: 'info' | 'success' | 'error' | 'none';
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
    const displayPrice = price === null ? '--' : config.priceHidden ? PRICE_MASK : formatPrice(price);
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
  readonly stocks: readonly StockCardViewModel[];
  readonly toolbar: ToolbarViewModel;
  readonly batchToolbar: BatchToolbarViewModel;
  readonly quoteStatus: QuoteStatusViewModel;
  readonly liveRegion: LiveRegionViewModel;
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
