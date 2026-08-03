// src/domain/stock.ts
// 股票实体与代码规范化。normalizeStockCode 是品牌类型的唯一 escape hatch。
import type { StockCode, GroupId } from './brands.js';

/**
 * 股票实体：自选股的一条记录。
 * groupIds 仅包含自定义分组（绝不包含 g_all）；manualOrder/pinned 按 groupId 索引。
 */
export interface Stock {
  readonly code: StockCode;
  readonly name: string;
  readonly groupIds: readonly GroupId[];
  readonly manualOrder: Readonly<Record<GroupId, number>>;
  readonly pinned: Readonly<Record<GroupId, boolean>>;
  readonly addedAt: number;
}

/**
 * 规范化股票代码：接受裸代码或带显式市场前缀的代码，返回 `<market><6digits>`。
 * 仅支持沪深北 A 股；显式前缀与推断市场冲突时返回 null。
 *
 * 市场判定（与 v1.3 stock-utils.js 一致）：
 * - sh: 600/601/603/605/688/689
 * - sz: 000/001/002/003/300/301
 * - bj: 4/8/920（4 和 8 是单字符前缀，920 是三字符）
 */
export function normalizeStockCode(input: unknown): StockCode | null {
  const value = String(input ?? '').trim().toLowerCase();
  const match = /^(?:(sh|sz|bj))?(\d{6})$/.exec(value);
  if (!match) return null;
  const [, explicit, digits] = match;
  const inferred = inferMarket(digits);
  if (!inferred || (explicit && explicit !== inferred)) return null;
  return `${inferred}${digits}` as StockCode;
}

function inferMarket(digits: string): 'sh' | 'sz' | 'bj' | null {
  if (/^(600|601|603|605|688|689)/.test(digits)) return 'sh';
  if (/^(000|001|002|003|300|301)/.test(digits)) return 'sz';
  if (/^(4|8|920)/.test(digits)) return 'bj';
  return null;
}
