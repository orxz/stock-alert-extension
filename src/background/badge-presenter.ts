// src/background/badge-presenter.ts
// 纯 Badge/Tooltip 投影函数：从排序后的 stocks + quoteSnapshot 派生 ActionState。
// 零副作用：不调用 chrome.action / Date.now() / DOM——仅 import domain 纯函数。
//
// 行为契约（与 v1.3 renderChrome 第 106-125 行精确一致）：
// - 空 watchlist → { text:'', color:'', title:'股票提醒助手\n暂无自选股，点击添加' }。
// - 非空：badgeStock = stocks[0]（调用方已排序），formatBadgeState(results[badgeStock.code])；
//   tooltip 前 TOOLTIP_MAX（5）只股票的 formatTooltipLine 拼接；hasAnyQuote 判断。
// - 无任何可用行情 → title:'股票提醒助手\n暂无可用行情'（badge 仍显示 badgeStock 的状态）。
//
// 注意：stocks 传入时必须已排序（由 scheduler 用 sortStocks 排序后传入）。
// badge-presenter 不排序——它是纯投影，不依赖排序方向/字段。
import type { Stock } from '../domain/stock.js';
import type { QuoteSnapshot } from '../domain/quote.js';
import { formatBadgeState, formatTooltipLine } from '../domain/formatting.js';
import type { ActionState } from '../application/ports/action-presenter.js';

/** Tooltip 最多显示的股票行数（与 v1.3 TOOLTIP_MAX 一致）。 */
const TOOLTIP_MAX = 5;

/** 空看板标题前缀。 */
const TITLE_PREFIX = '股票提醒助手\n';

/**
 * 从排序后的 stocks + quoteSnapshot 派生 ActionState（Badge text/color + Tooltip title）。
 *
 * @param stocks 已排序的股票列表（由调用方用 sortStocks 排序）。
 * @param snapshot 行情快照（results 按 code 索引）。
 * @param _now 当前时间戳（保留参数，与 brief 签名一致；当前投影逻辑不需要——
 *   formatTooltipLine 内部使用 result.fetchedAt 显示缓存时间）。
 * @returns ActionState：{ text, color, title }。
 */
export function projectActionState(
  stocks: readonly Stock[],
  snapshot: QuoteSnapshot,
  _now: number
): ActionState {
  if (stocks.length === 0) {
    return {
      text: '',
      color: '',
      title: `${TITLE_PREFIX}暂无自选股，点击添加`
    };
  }

  const badgeStock = stocks[0];
  const badge = formatBadgeState(snapshot.results[badgeStock.code]);

  const lines = stocks
    .slice(0, TOOLTIP_MAX)
    .map((stock) => formatTooltipLine(stock, snapshot.results[stock.code]));
  const hasAnyQuote = stocks.some(
    (stock) => snapshot.results[stock.code]?.quote !== null && snapshot.results[stock.code]?.quote !== undefined
  );

  const title = hasAnyQuote
    ? TITLE_PREFIX + lines.join('\n')
    : `${TITLE_PREFIX}暂无可用行情`;

  return {
    text: badge.text,
    color: badge.color,
    title
  };
}
