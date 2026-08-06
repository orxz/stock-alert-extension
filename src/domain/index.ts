// src/domain/index.ts
// Domain 层 barrel export：稳定的值对象、实体、规则与格式化。
// 纯净层——仅依赖 ES2022，零副作用（不调用 Date.now() / Chrome / DOM）。
export type { Brand, StockCode, GroupId, UserDataRevision } from './brands.js';
export type { Group } from './group.js';
export type { Stock } from './stock.js';
export type { Quote, QuoteCacheEntry, QuoteResult, QuoteSnapshot, StockSearchResult } from './quote.js';
export type { ViewMode, SortField, SortDirection, BoardConfig, UserData } from './board-config.js';
export type { ErrorCode, AppError } from './errors.js';
export type { BadgeState } from './formatting.js';
export { normalizeStockCode } from './stock.js';
export { isUsableQuote, snapshotFromCache } from './quote.js';
export { sortStocks, stocksForGroup } from './portfolio.js';
export {
  formatTime,
  formatBadge,
  formatBadgeState,
  formatTooltipLine,
  formatVolume,
  formatAmount,
  chinaTimeParts,
  isChinaMarketActive,
  getRefreshIntervalMs
} from './formatting.js';
