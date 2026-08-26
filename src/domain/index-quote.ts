// src/domain/index-quote.ts
// 大盘指数目录与行情投影（v2.1）。
//
// 两个职责：
// 1. INDEX_CATALOG：固定指数条的默认目录（唯一真相）——popup 顶部常驻展示，
//    不进 watchlist、不占分组/排序体系，用户不可增删。
// 2. projectIndexQuote：指数行情投影——从 Provider 的 Quote 中剔除对指数
//    无意义或两源口径矛盾的字段，防止假数据流入展示层。
//
// 为什么需要在 domain 层剔除字段（实测证据见 docs/调研-大盘指数支持.md §3）：
// - 东财指数 PE/PB 上报 0（f9=0 f23=0）——num(0) 非 null，会在表格里渲染 0.00；
// - 腾讯指数 PE=17.70 与东财 0 矛盾——两源展示不同的假值；
// - 腾讯指数涨跌停上报 -1（[47]/[48]）——会渲染 -1.00。
// 处理原则与 f51/f52 一致：字段含义随品种变化，从源头剔除而不是展示层打补丁。
import type { StockCode } from './brands.js';
import type { Quote } from './quote.js';
import { normalizeStockCode } from './stock.js';

/** 指数目录条目：代码 + 显示名（显示名是 UI 唯一真相，行情 name 仅作刷新对账）。 */
export interface IndexCatalogEntry {
  readonly code: StockCode;
  readonly name: string;
}

/** 原始目录定义（sh000xxx / sz399xxx / bj899xxx 指数段，经 normalizeStockCode 规范化）。 */
const RAW_INDEX_CATALOG: readonly { readonly raw: string; readonly name: string }[] = [
  { raw: 'sh000001', name: '上证指数' },
  { raw: 'sz399001', name: '深证成指' },
  { raw: 'sz399006', name: '创业板指' },
  // 科创板（v2.2）：科创50 指数。科创板个股代码段 688/689 已在 normalizeStockCode 支持。
  { raw: 'sh000688', name: '科创50' }
];

/**
 * 固定指数条目录：模块级常量，加载时即校验（坏代码直接抛错，fail-fast）。
 * 指数代码必须落在指数段上——normalizeStockCode 在本模块加载时即完成
 * 规范化，杜绝手写品牌类型绕过校验。
 */
export const INDEX_CATALOG: readonly IndexCatalogEntry[] = Object.freeze(
  RAW_INDEX_CATALOG.map(({ raw, name }) => {
    const code = normalizeStockCode(raw);
    if (code === null || !raw.startsWith(code.slice(0, 2))) {
      throw new Error(`INDEX_CATALOG: invalid index code ${raw}`);
    }
    return Object.freeze({ code, name });
  })
);

/** 目录代码清单（供刷新合并 / 缓存豁免等场景按数组消费）。 */
export const INDEX_CATALOG_CODES: readonly StockCode[] = Object.freeze(
  INDEX_CATALOG.map((entry) => entry.code)
);

/**
 * 指数行情投影：剔除对指数无意义或两源口径矛盾的字段。
 *
 * 保留：价格 / 涨跌额 / 涨跌幅 / 成交额 / 开高低 / 昨收 / 成交量 /
 * 换手率 / 振幅 / 量比 / 总市值 / 流通市值（两源实测口径一致）。
 * 剔除：pe / pb / limitUp / limitDown（见文件头说明——0 / -1 / 口径矛盾的哨兵值）。
 */
export function projectIndexQuote(quote: Quote): Quote {
  return {
    code: quote.code,
    name: quote.name,
    price: quote.price,
    change: quote.change,
    changePercent: quote.changePercent,
    amount: quote.amount,
    ...(quote.prevClose !== undefined ? { prevClose: quote.prevClose } : null),
    ...(quote.open !== undefined ? { open: quote.open } : null),
    ...(quote.high !== undefined ? { high: quote.high } : null),
    ...(quote.low !== undefined ? { low: quote.low } : null),
    ...(quote.volume !== undefined ? { volume: quote.volume } : null),
    ...(quote.turnoverRate !== undefined ? { turnoverRate: quote.turnoverRate } : null),
    ...(quote.amplitude !== undefined ? { amplitude: quote.amplitude } : null),
    ...(quote.volumeRatio !== undefined ? { volumeRatio: quote.volumeRatio } : null),
    ...(quote.totalMarketCap !== undefined ? { totalMarketCap: quote.totalMarketCap } : null),
    ...(quote.floatMarketCap !== undefined ? { floatMarketCap: quote.floatMarketCap } : null)
  };
}
