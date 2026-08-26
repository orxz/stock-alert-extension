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
 * 规范化证券代码：接受裸代码或带显式市场前缀的代码，返回 `<market><6digits>`。
 * 沪深北 A 股 + 交易所大盘指数；显式前缀与推断市场冲突时返回 null。
 *
 * 股票市场判定（与 v1.3 stock-utils.js 一致）：
 * - sh: 600/601/603/605/688/689
 * - sz: 000/001/002/003/300/301/302（302 为 2025 年深交所创业板新增代码段，如中航成飞 302132）
 * - bj: 4/8/920（4 和 8 是单字符前缀，920 是三字符）
 *
 * 指数段（v2.1 大盘指数支持，实测见 docs/调研-大盘指数支持.md）：
 * - sh: 000xxx（上证系列：上证指数 000001、上证50 000016、沪深300 000300、科创50 000688、中证500 000905）
 * - sz: 399xxx（深证系列：深证成指 399001、创业板指 399006 等）
 * - bj: 899xxx（北证50 899050）
 *
 * 歧义消解（关键兼容决策）：裸 `000xxx` **仍归深市股票**（sz000001=平安银行），
 * 只有显式 `sh` 前缀才归沪市指数——否则所有存量裸 000 代码的语义都会翻转。
 * 裸 `399xxx`/`899xxx` 无股票歧义（深市股票无 399 段、899 已按 bj 股票 8 字头推导），直接归指数。
 */
export function normalizeStockCode(input: unknown): StockCode | null {
  const value = String(input ?? '').trim().toLowerCase();
  const match = /^(?:(sh|sz|bj))?(\d{6})$/.exec(value);
  if (!match) return null;
  const [, explicit, digits] = match;
  const stockMarket = inferStockMarket(digits);
  const indexMarket = inferIndexMarket(digits);
  if (explicit) {
    // 显式前缀：股票段优先，其次指数段；都不匹配则冲突 → null。
    if (stockMarket === explicit || indexMarket === explicit) {
      return `${explicit}${digits}` as StockCode;
    }
    return null;
  }
  // 裸代码：股票段优先（000 → sz 股票，保持 v1 兼容），其次指数段（399/899）。
  const market = stockMarket ?? indexMarket;
  return market ? `${market}${digits}` as StockCode : null;
}

/** 股票段市场判定（不含指数段）。 */
function inferStockMarket(digits: string): 'sh' | 'sz' | 'bj' | null {
  if (/^(600|601|603|605|688|689)/.test(digits)) return 'sh';
  if (/^(000|001|002|003|300|301|302)/.test(digits)) return 'sz';
  if (/^(4|8|920)/.test(digits)) return 'bj';
  return null;
}

/** 指数段市场判定：sh000xxx / sz399xxx / bj899xxx。 */
function inferIndexMarket(digits: string): 'sh' | 'sz' | 'bj' | null {
  if (/^000/.test(digits)) return 'sh';
  if (/^399/.test(digits)) return 'sz';
  if (/^899/.test(digits)) return 'bj';
  return null;
}

/**
 * 判定代码是否为交易所大盘指数（sh000xxx / sz399xxx / bj899xxx）。
 * 这三个段位不存在股票（沪市股票从 60x 起、深市股票无 399 段、北交所股票无 899 段），
 * 判定是纯前缀规则，无例外。指数行的估值/涨跌停字段在解析层被剔除（见 index-quote.ts）。
 */
export function isIndexCode(code: string): boolean {
  const value = code.toLowerCase();
  return value.startsWith('sh000') || value.startsWith('sz399') || value.startsWith('bj899');
}
