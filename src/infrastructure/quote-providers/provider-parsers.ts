// src/infrastructure/quote-providers/provider-parsers.ts
// 纯解析器：parseEastmoney / parseSina / parseEastmoneySearch。
// 无 fetch 依赖——接收已解析的 JSON 或文本，返回规范化的 domain Quote / StockSearchResult。
// 可独立测试（Task 8 Step 1 的纯函数测试直接调用）。
// 从 v1.3 quotes.js 移植，适配 v2 domain Quote 类型（精简字段 + 价格缩放）。
import type { StockCode } from '../../domain/brands.js';
import type { Quote, StockSearchResult } from '../../domain/quote.js';

/** Eastmoney fltt=2 返回的数值需 ÷100 还原为正确小数。 */
const PRICE_SCALE = 100;

/**
 * 安全数值解析：接受 number/string，返回有限数或 null。
 * 与 v1.3 enrich._num 一致：'-'、''、null、undefined → null。
 */
function num(value: unknown): number | null {
  if (value === '-' || value === '' || value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/** 缩放价格类字段：num(value) / 100。 */
function scalePrice(value: unknown): number | null {
  const n = num(value);
  return n !== null ? n / PRICE_SCALE : null;
}

/** Eastmoney 行情行（f 字段）原始形状。 */
interface EastmoneyRow {
  f12?: unknown; // 代码
  f13?: unknown; // 市场（1=sh）
  f14?: unknown; // 名称
  f2?: unknown;  // 现价
  f3?: unknown;  // 涨跌幅
  f4?: unknown;  // 涨跌额
  f5?: unknown;  // 成交量
  f6?: unknown;  // 成交额
  f15?: unknown; // 高
  f16?: unknown; // 低
  f17?: unknown; // 开
  f18?: unknown; // 昨收
}

/**
 * 规范化行情并执行 enrich 规则：
 * - price <= 0 → 返回 null（A 股停牌/盘前接口常返回 0.00，必须丢弃）。
 * - change 缺失时从 price-prevClose 计算。
 * - changePercent 缺失时从 change/prevClose*100 计算。
 */
function enrichQuote(raw: {
  code: StockCode;
  name: string;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePercent: number | null;
  amount: number | null;
}): Quote | null {
  const price = raw.price !== null && raw.price > 0 ? raw.price : null;
  if (price === null) return null;

  let change = raw.change;
  if (change === null && raw.prevClose !== null) {
    change = +(price - raw.prevClose).toFixed(2);
  }
  let changePercent = raw.changePercent;
  if (changePercent === null && change !== null && raw.prevClose && raw.prevClose > 0) {
    changePercent = +((change / raw.prevClose) * 100).toFixed(2);
  }

  return {
    code: raw.code,
    name: raw.name,
    price,
    change: change ?? 0,
    changePercent: changePercent ?? 0,
    amount: raw.amount ?? 0
  };
}

/**
 * 解析 Eastmoney 行情 JSON：json.data.diff 数组 → Record<StockCode, Quote>。
 * 价格类字段（f2/f3/f4/f18）÷100 缩放；价格为 0 或非有限 → 丢弃。
 * 市场前缀：f13===1?'sh':/^[489]\d{5}$/.test(code)?'bj':'sz'。
 */
export function parseEastmoney(json: unknown): Readonly<Record<StockCode, Quote>> {
  const result = {} as Record<StockCode, Quote>;
  const rows = (json as { data?: { diff?: unknown } })?.data?.diff;
  if (!Array.isArray(rows)) return result;

  for (const item of rows) {
    if (!item || (item as EastmoneyRow).f12 == null) continue;
    const row = item as EastmoneyRow;
    const rawCode = String(row.f12);
    const prefix = row.f13 === 1 ? 'sh' : /^[489]\d{5}$/.test(rawCode) ? 'bj' : 'sz';
    const code = (prefix + rawCode) as StockCode;

    const quote = enrichQuote({
      code,
      name: String(row.f14 || rawCode),
      price: scalePrice(row.f2),
      prevClose: scalePrice(row.f18),
      change: scalePrice(row.f4),
      changePercent: scalePrice(row.f3),
      amount: num(row.f6)
    });
    if (quote) result[code] = quote;
  }
  return result;
}

/**
 * 解析 Sina 行情文本（GBK 已解码）：逐行匹配 hq_str_<code>="..." 格式。
 * 字段逗号分隔：[0]=名称 [1]=开 [2]=昨收 [3]=现价 [4]=高 [5]=低 [8]=成交量 [9]=成交额。
 * price=parseFloat(fields[3])，非有限或 price<=0 → 跳过。
 */
export function parseSina(text: string): Readonly<Record<StockCode, Quote>> {
  const result = {} as Record<StockCode, Quote>;
  for (const line of text.split('\n')) {
    const match = line.match(/hq_str_(\w+?)="(.*)"/);
    if (!match) continue;
    const [, responseCode, body] = match;
    const fields = body.split(',');
    const price = Number.parseFloat(fields[3]);
    if (fields.length < 4 || !fields[0] || !Number.isFinite(price)) continue;

    const code = responseCode.toLowerCase() as StockCode;
    const quote = enrichQuote({
      code,
      name: fields[0],
      price: num(price),
      prevClose: num(fields[2]),
      change: null,
      changePercent: null,
      amount: num(fields[9])
    });
    if (quote) result[code] = quote;
  }
  return result;
}

/** Eastmoney 搜索有效的 SecurityType 集合。 */
const VALID_SECURITY_TYPES = new Set(['1', '2', '25', '27']);

/**
 * 解析 Eastmoney 搜索 JSON：QuotationCodeTable.Data（或 _oma_data.QuotationCodeTable.Data）。
 * 过滤：SecurityType in {'1','2','25','27'} 或 (!SecurityType && Classify==='AStock')。
 * code 格式 6 位数字；前缀：27→bj, (25||1||MktNum==='1')→sh, 否则 sz。
 */
export function parseEastmoneySearch(json: unknown): readonly StockSearchResult[] {
  const obj = json as {
    QuotationCodeTable?: { Data?: unknown[] };
    _oma_data?: { QuotationCodeTable?: { Data?: unknown[] } };
  };
  const table = obj?.QuotationCodeTable || obj?._oma_data?.QuotationCodeTable;
  const data = table?.Data;
  if (!Array.isArray(data)) return [];

  const results: StockSearchResult[] = [];
  for (const entry of data) {
    if (!entry) continue;
    const item = entry as {
      Code?: unknown;
      Name?: unknown;
      PinYin?: unknown;
      SecurityType?: unknown;
      Classify?: unknown;
      MktNum?: unknown;
    };
    const securityType = String(item.SecurityType || '');
    const classify = String(item.Classify || '');
    if (!VALID_SECURITY_TYPES.has(securityType) && !(!item.SecurityType && classify === 'AStock')) continue;
    const rawCode = String(item.Code || '');
    if (!/^\d{6}$/.test(rawCode)) continue;
    const prefix = securityType === '27'
      ? 'bj'
      : securityType === '25' || securityType === '1' || item.MktNum === '1'
        ? 'sh'
        : 'sz';
    results.push({
      code: (prefix + rawCode) as StockCode,
      name: String(item.Name || rawCode),
      pinyin: String(item.PinYin || ''),
      tags: []
    });
  }
  return results;
}
