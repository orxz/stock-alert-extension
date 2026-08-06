// src/infrastructure/quote-providers/local-stock-catalog.ts
// 本地热门股票目录：远端搜索降级时使用。
// 包含 ~25 只常见 A 股龙头股（沪深北），每项 {code, name, pinyin, tags}。
// searchLocalCatalog 按查询词模糊匹配 name/code/pinyin，返回所有命中项。
// 这是一个新的 v2 能力（设计文档 §5 搜索降级）——不 fetch、不持久化额外数据。
import type { StockCode } from '../../domain/brands.js';
import type { StockSearchResult } from '../../domain/quote.js';

/** 品牌类型构造辅助（StockCode 唯一合法 escape hatch 在 normalizeStockCode 内）。 */
function code(c: string): StockCode {
  return c as StockCode;
}

/** 本地热门 A 股目录（按市值/知名度选取的龙头股）。 */
export const LOCAL_STOCK_CATALOG: readonly StockSearchResult[] = [
  { code: code('sh600519'), name: '贵州茅台', pinyin: 'gzmt', tags: [] },
  { code: code('sz000001'), name: '平安银行', pinyin: 'payh', tags: [] },
  { code: code('sz300750'), name: '宁德时代', pinyin: 'ndsd', tags: [] },
  { code: code('sh601318'), name: '中国平安', pinyin: 'zgpa', tags: [] },
  { code: code('sh600036'), name: '招商银行', pinyin: 'zsyh', tags: [] },
  { code: code('sz000858'), name: '五粮液', pinyin: 'wly', tags: [] },
  { code: code('sh600276'), name: '恒瑞医药', pinyin: 'hryy', tags: [] },
  { code: code('sz002594'), name: '比亚迪', pinyin: 'byd', tags: [] },
  { code: code('sh600030'), name: '中信证券', pinyin: 'zxzq', tags: [] },
  { code: code('sh601012'), name: '隆基绿能', pinyin: 'ljln', tags: [] },
  { code: code('sz000651'), name: '格力电器', pinyin: 'gldq', tags: [] },
  { code: code('sh600887'), name: '伊利股份', pinyin: 'ylgf', tags: [] },
  { code: code('sz002415'), name: '海康威视', pinyin: 'hkws', tags: [] },
  { code: code('sh601899'), name: '紫金矿业', pinyin: 'zjky', tags: [] },
  { code: code('sz300059'), name: '东方财富', pinyin: 'dfcf', tags: [] },
  { code: code('sh600900'), name: '长江电力', pinyin: 'cjdl', tags: [] },
  { code: code('sz000333'), name: '美的集团', pinyin: 'mdjt', tags: [] },
  { code: code('sh601398'), name: '工商银行', pinyin: 'gsyh', tags: [] },
  { code: code('sh601288'), name: '农业银行', pinyin: 'nyyh', tags: [] },
  { code: code('sh601988'), name: '中国银行', pinyin: 'zgyh', tags: [] },
  { code: code('sh601628'), name: '中国人寿', pinyin: 'zgrs', tags: [] },
  { code: code('sz002304'), name: '洋河股份', pinyin: 'yhgf', tags: [] },
  { code: code('sh600031'), name: '三一重工', pinyin: 'syzg', tags: [] },
  { code: code('sz300760'), name: '迈瑞医疗', pinyin: 'mryl', tags: [] },
  { code: code('sh601633'), name: '长城汽车', pinyin: 'ccqc', tags: [] },
  { code: code('sh600009'), name: '上海机场', pinyin: 'shjc', tags: [] },
  { code: code('sz000002'), name: '万科A', pinyin: 'wka', tags: [] },
  { code: code('sh600585'), name: '海螺水泥', pinyin: 'hlsn', tags: [] }
];

/**
 * 本地目录模糊搜索：按 name（中文子串）/ code（小写子串）/ pinyin（小写子串）匹配。
 * 返回所有命中项（调用方负责 slice(0, 20) 限流）。
 *
 * @param query 搜索关键词（已 trim 或未 trim 均可）
 * @returns 命中的 StockSearchResult 列表
 */
export function searchLocalCatalog(query: string): readonly StockSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const q = trimmed.toLowerCase();
  return LOCAL_STOCK_CATALOG.filter(
    (item) =>
      item.name.includes(trimmed) ||
      item.code.toLowerCase().includes(q) ||
      item.pinyin.toLowerCase().includes(q)
  );
}
