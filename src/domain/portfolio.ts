// src/domain/portfolio.ts
// 纯排序与分组计算视图。零副作用：不调用 Date.now() / Chrome / DOM。
import type { GroupId } from './brands.js';
import type { Stock } from './stock.js';
import type { QuoteSnapshot } from './quote.js';
import type { BoardConfig } from './board-config.js';

/** `g_all` 是固定计算视图，绝不写入任何 stock.groupIds。 */
const ALL_GROUP_ID = 'g_all' as GroupId;

/**
 * 返回指定分组的股票列表（副本）。
 * - `g_all` 返回全部股票，且不修改任何 stock 的 groupIds。
 * - 自定义分组按 `stock.groupIds.includes(groupId)` 过滤。
 */
export function stocksForGroup(stocks: readonly Stock[], groupId: GroupId): readonly Stock[] {
  if (groupId === ALL_GROUP_ID) return [...stocks];
  return stocks.filter((stock) => stock.groupIds.includes(groupId));
}

/**
 * 纯排序：保持 pinned 优先，支持 manual/addedAt/name/price/change/changePercent/amount。
 *
 * 规则（与 v1.3 stock-utils.js 精确一致）：
 * - 先按 pinned[groupId]（true 在前）。
 * - manual：用 manualOrder[groupId] ?? 9999（缺省排末尾），**不受 direction 影响**。
 * - addedAt：升序时旧在前，降序时新在前。
 * - name：localeCompare，受 direction 影响。
 * - price/change/changePercent/amount：从 quotes.results[code].quote[field] 取值；
 *   缺失（非 number）排末尾，两个都缺失时返回 0（保持稳定），受 direction 影响。
 * - Array.prototype.sort 在 V8 下稳定（ES2019+），无需额外 tiebreak。
 */
export function sortStocks(
  stocks: readonly Stock[],
  quotes: QuoteSnapshot,
  groupId: GroupId,
  config: Pick<BoardConfig, 'sortField' | 'sortDirection'>
): readonly Stock[] {
  const multiplier = config.sortDirection === 'asc' ? 1 : -1;
  return [...stocks].sort((left, right) => {
    const leftPinned = left.pinned[groupId] ? 1 : 0;
    const rightPinned = right.pinned[groupId] ? 1 : 0;
    if (leftPinned !== rightPinned) return rightPinned - leftPinned;
    const field = config.sortField;
    if (field === 'manual') {
      return (left.manualOrder[groupId] ?? 9999) - (right.manualOrder[groupId] ?? 9999);
    }
    if (field === 'addedAt') return ((left.addedAt || 0) - (right.addedAt || 0)) * multiplier;
    if (field === 'name') return String(left.name || '').localeCompare(String(right.name || '')) * multiplier;
    // field 已收窄为 'price' | 'change' | 'changePercent' | 'amount'
    const leftValue = quotes.results[left.code]?.quote?.[field];
    const rightValue = quotes.results[right.code]?.quote?.[field];
    // 缺失（非 number）排末尾；两者都缺失时返回 0（稳定）
    if (typeof leftValue !== 'number' && typeof rightValue !== 'number') return 0;
    if (typeof leftValue !== 'number') return 1;
    if (typeof rightValue !== 'number') return -1;
    return (leftValue - rightValue) * multiplier;
  });
}
