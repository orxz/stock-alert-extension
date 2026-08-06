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
import { DEFAULT_BOARD_CONFIG } from '../domain/portfolio.js';
import type { ColumnKey } from './ui-preferences.js';

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
  /** 涨跌额展示文本（带符号）；缺失时 '--'。 */
  readonly displayChange: string;
  /** 成交额展示文本（亿/万分级）；缺失时 '--'。 */
  readonly displayAmount: string;
  /** 今开展示文本（价格隐藏时掩码；缺失 '--'）。 */
  readonly displayOpen: string;
  /** 当日最高展示文本（价格隐藏时掩码；缺失 '--'）。 */
  readonly displayHigh: string;
  /** 当日最低展示文本（价格隐藏时掩码；缺失 '--'）。 */
  readonly displayLow: string;
  /** 昨收展示文本（价格隐藏时掩码；缺失 '--'）。 */
  readonly displayPrevClose: string;
  /** 成交量展示文本（≥1 万手 → 「X.X万」；缺失 '--'）。 */
  readonly displayVolume: string;
  /** 换手率展示文本（百分比两位小数 + %）；缺失 '--'。 */
  readonly displayTurnoverRate: string;
  /** 振幅展示文本（百分比两位小数 + %）；缺失 '--'。 */
  readonly displayAmplitude: string;
  /** 量比展示文本（两位小数）；缺失 '--'。 */
  readonly displayVolumeRatio: string;
  /** 市盈率展示文本（两位小数）；缺失 '--'。 */
  readonly displayPe: string;
  /** 市净率展示文本（两位小数）；缺失 '--'。 */
  readonly displayPb: string;
  /** 总市值展示文本（元→亿/万亿分级）；缺失 '--'。 */
  readonly displayTotalMarketCap: string;
  /** 流通市值展示文本（元→亿/万亿分级）；缺失 '--'。 */
  readonly displayFloatMarketCap: string;
  /** 涨停价展示文本（价格隐藏时掩码；缺失 '--'）。 */
  readonly displayLimitUp: string;
  /** 跌停价展示文本（价格隐藏时掩码；缺失 '--'）。 */
  readonly displayLimitDown: string;
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
  readonly priceHidden: boolean;
  readonly canAddStock: boolean;
  readonly theme: 'dark' | 'light';
}

/** 批量工具栏视图模型（选中态）。 */
export interface BatchToolbarViewModel {
  readonly visible: boolean;
  readonly selectedCount: number;
  readonly totalCount: number;
  readonly selectedCodes: readonly StockCode[];
  readonly groupId: GroupId;
}

/** 看板视图模型：视图模式 + 股票列表 + 加载/空/错误状态。 */
export interface BoardViewModel {
  readonly viewMode: ViewMode;
  readonly groupId: GroupId;
  readonly stocks: readonly StockCardViewModel[];
  /** 主列显示顺序（列设置面板重排后的完整主列排列）——列表视图据此排布列。 */
  readonly columns: readonly ColumnKey[];
  /** 启用的列集合——列表/卡片视图据此显隐字段。 */
  readonly enabledColumns: readonly ColumnKey[];
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

/** 单只股票的操作菜单视图模型（纯数据，含可用性判定）。 */
export interface StockActionMenuViewModel {
  readonly code: StockCode;
  readonly name: string;
  readonly pinned: boolean;
  /** 已在首位时禁用上移、末位时禁用下移——避免发出无效的重排命令。 */
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly groupId: GroupId;
  /** 当前可见顺序的完整 code 列表；重排命令以最终态形式携带。 */
  readonly orderedCodes: readonly StockCode[];
}

/** 弹出层视图模型（列设置 / 股票操作等轻量非模态面板）。 */
export interface PopoverViewModel {
  readonly open: boolean;
  readonly kind: 'column-settings' | 'stock-actions' | null;
  readonly anchorId: string | null;
  readonly columnPanel: ColumnPanelViewModel | null;
  readonly stockActions: StockActionMenuViewModel | null;
}

/** 关闭态 PopoverViewModel。 */
export function closedPopover(): PopoverViewModel {
  return { open: false, kind: null, anchorId: null, columnPanel: null, stockActions: null };
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

/** 默认看板配置：委托 domain 的唯一定义，避免各层各存一份副本后漂移。 */
export function defaultBoardConfig(): BoardConfig {
  return DEFAULT_BOARD_CONFIG;
}

/** 格式化价格（两位小数）；非有限→'--'。 */
function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return '--';
  return price.toFixed(2);
}

/**
 * 格式化成交额展示文本——主流场景单位最小为亿：
 * ≥1 万亿 →「X.X万亿」；≥1 亿 →「X.X亿」；≥100 万 →「亿」两位小数（去尾零）；
 * <100 万回退「X万」——低于 100 万时亿的两位小数仍会显示 0.00亿，读作零成交。
 * 非有限或非正→'--'。
 */
function formatAmountText(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '--';
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}万亿`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (v >= 1e6) return `${Number((v / 1e8).toFixed(2))}亿`;
  return `${(v / 1e4).toFixed(0)}万`;
}

const PRICE_MASK = '****';

/** 百分比展示文本（两位小数 + %）；非有限→'--'。 */
function formatPercentText(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '--';
  return `${v.toFixed(2)}%`;
}

/** 倍数展示文本（两位小数）；非有限→'--'。 */
function formatRatioText(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '--';
  return v.toFixed(2);
}

/** 市值展示文本（元→万/亿/万亿分级）；非有限或非正→'--'。 */
function formatCapText(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return '--';
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}万亿`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  return `${(v / 1e4).toFixed(1)}万`;
}

/** 详情面板价格文本：价格隐藏时掩码；非有限→'--'。 */
function formatDetailPrice(v: number | null | undefined, priceHidden: boolean): string {
  if (priceHidden) return PRICE_MASK;
  if (v === null || v === undefined || !Number.isFinite(v)) return '--';
  return v.toFixed(2);
}

/** 成交量（手）展示文本：≥1 万手 → 「X.X万」；否则原样取整；非正→'--'。 */
function formatVolumeText(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '--';
  if (v >= 10_000) return `${(v / 10_000).toFixed(1)}万`;
  return v.toFixed(0);
}

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
    const amount = quote && Number.isFinite(quote.amount) ? quote.amount : null;
    const open = quote && quote.open != null && Number.isFinite(quote.open) ? quote.open : null;
    const high = quote && quote.high != null && Number.isFinite(quote.high) ? quote.high : null;
    const low = quote && quote.low != null && Number.isFinite(quote.low) ? quote.low : null;
    const prevClose = quote && quote.prevClose != null && Number.isFinite(quote.prevClose) ? quote.prevClose : null;
    const volume = quote && quote.volume != null && Number.isFinite(quote.volume) ? quote.volume : null;
    const turnoverRate = quote && quote.turnoverRate != null && Number.isFinite(quote.turnoverRate) ? quote.turnoverRate : null;
    const amplitude = quote && quote.amplitude != null && Number.isFinite(quote.amplitude) ? quote.amplitude : null;
    const volumeRatio = quote && quote.volumeRatio != null && Number.isFinite(quote.volumeRatio) ? quote.volumeRatio : null;
    const pe = quote && quote.pe != null && Number.isFinite(quote.pe) ? quote.pe : null;
    const pb = quote && quote.pb != null && Number.isFinite(quote.pb) ? quote.pb : null;
    const totalMarketCap = quote && quote.totalMarketCap != null && Number.isFinite(quote.totalMarketCap) ? quote.totalMarketCap : null;
    const floatMarketCap = quote && quote.floatMarketCap != null && Number.isFinite(quote.floatMarketCap) ? quote.floatMarketCap : null;
    const limitUp = quote && quote.limitUp != null && Number.isFinite(quote.limitUp) ? quote.limitUp : null;
    const limitDown = quote && quote.limitDown != null && Number.isFinite(quote.limitDown) ? quote.limitDown : null;
    const status = result?.status ?? 'missing';
    const displayPrice = config.priceHidden ? PRICE_MASK : price === null ? '--' : formatPrice(price);
    const displayChange = change === null ? '--' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}`;
    const displayAmount = amount === null ? '--' : formatAmountText(amount);
    return {
      code: stock.code,
      name: stock.name,
      price,
      change,
      changePercent,
      status,
      pinned: stock.pinned[groupId] ?? false,
      staleLabel: status === 'cached' ? '已过期' : '',
      displayPrice,
      displayChange,
      displayAmount,
      displayOpen: formatDetailPrice(open, config.priceHidden),
      displayHigh: formatDetailPrice(high, config.priceHidden),
      displayLow: formatDetailPrice(low, config.priceHidden),
      displayPrevClose: formatDetailPrice(prevClose, config.priceHidden),
      displayVolume: volume === null ? '--' : formatVolumeText(volume),
      displayTurnoverRate: formatPercentText(turnoverRate),
      displayAmplitude: formatPercentText(amplitude),
      displayVolumeRatio: formatRatioText(volumeRatio),
      displayPe: formatRatioText(pe),
      displayPb: formatRatioText(pb),
      displayTotalMarketCap: formatCapText(totalMarketCap),
      displayFloatMarketCap: formatCapText(floatMarketCap),
      displayLimitUp: formatDetailPrice(limitUp, config.priceHidden),
      displayLimitDown: formatDetailPrice(limitDown, config.priceHidden)
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
  readonly popover: PopoverViewModel;
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
