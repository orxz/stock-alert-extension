// src/infrastructure/quote-providers/provider-parsers.ts
// 纯解析器：parseEastmoney / parseTencent / parseEastmoneySearch。
// 无 fetch 依赖——接收已解析的 JSON 或文本，返回规范化的 domain Quote / StockSearchResult。
// 可独立测试（Task 8 Step 1 的纯函数测试直接调用）。
// 从 v1.3 quotes.js 移植，适配 v2 domain Quote 类型（精简字段）。fltt=2 返回浮点值，无价格缩放。
import type { StockCode } from '../../domain/brands.js';
import type { Quote, StockSearchResult } from '../../domain/quote.js';
import { isIndexCode } from '../../domain/stock.js';
import { projectIndexQuote } from '../../domain/index-quote.js';
import { computeLimitPrices } from '../../domain/limit-rule.js';

// fltt=2 返回浮点值（元/百分比），无需缩放。与 v1.3 enrich._num 一致：直接 parseFloat。

/**
 * 安全数值解析：接受 number/string，返回有限数或 null。
 * 与 v1.3 enrich._num 一致：'-'、''、null、undefined → null。
 */
function num(value: unknown): number | null {
  if (value === '-' || value === '' || value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
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
  f7?: unknown;  // 振幅
  f8?: unknown;  // 换手率
  f9?: unknown;  // 市盈率（动态）
  f10?: unknown; // 量比
  f15?: unknown; // 高
  f16?: unknown; // 低
  f17?: unknown; // 开
  f18?: unknown; // 昨收
  f20?: unknown; // 总市值
  f21?: unknown; // 流通市值
  f23?: unknown; // 市净率
  // 注意：ulist.np/get 上没有涨停/跌停字段。f51/f52 在该 endpoint 上装的是别的
  // 量纲（实测 sh600519 f51=2715 亿、sz000001 f51=0），只有 stock/get 上才是
  // 涨跌停价。详见 parseEastmoney 的说明与对应回归测试——涨跌停仅由腾讯源提供。
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
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  turnoverRate?: number | null;
  amplitude?: number | null;
  volumeRatio?: number | null;
  pe?: number | null;
  pb?: number | null;
  totalMarketCap?: number | null;
  floatMarketCap?: number | null;
  limitUp?: number | null;
  limitDown?: number | null;
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
    amount: raw.amount ?? 0,
    // 详情字段只在源数据确实提供时保留——缺失时保持 undefined，
    // 旧缓存与字段残缺的响应因此不会带出伪造的 0 值。
    ...(raw.prevClose !== null && raw.prevClose !== undefined ? { prevClose: raw.prevClose } : null),
    ...(raw.open !== null && raw.open !== undefined ? { open: raw.open } : null),
    ...(raw.high !== null && raw.high !== undefined ? { high: raw.high } : null),
    ...(raw.low !== null && raw.low !== undefined ? { low: raw.low } : null),
    ...(raw.volume !== null && raw.volume !== undefined ? { volume: raw.volume } : null),
    ...(raw.turnoverRate !== null && raw.turnoverRate !== undefined ? { turnoverRate: raw.turnoverRate } : null),
    ...(raw.amplitude !== null && raw.amplitude !== undefined ? { amplitude: raw.amplitude } : null),
    ...(raw.volumeRatio !== null && raw.volumeRatio !== undefined ? { volumeRatio: raw.volumeRatio } : null),
    ...(raw.pe !== null && raw.pe !== undefined ? { pe: raw.pe } : null),
    ...(raw.pb !== null && raw.pb !== undefined ? { pb: raw.pb } : null),
    ...(raw.totalMarketCap !== null && raw.totalMarketCap !== undefined ? { totalMarketCap: raw.totalMarketCap } : null),
    ...(raw.floatMarketCap !== null && raw.floatMarketCap !== undefined ? { floatMarketCap: raw.floatMarketCap } : null),
    ...(raw.limitUp !== null && raw.limitUp !== undefined ? { limitUp: raw.limitUp } : null),
    ...(raw.limitDown !== null && raw.limitDown !== undefined ? { limitDown: raw.limitDown } : null)
  };
}


/**
 * 涨跌停补齐（v2.5.5）：腾讯真值优先，缺失时按交易所规则推导（昨收×板块幅度，
 * 四舍五入到分——确定性公式而非模拟行情，规则表见 domain/limit-rule.ts）。
 * 背景：东财批量接口不返回涨跌停，而备源只在主源缺失时才被调用——
 * 主源成功的股票涨跌停长期 `--`。指数不适用（projectIndexQuote 会剔除）。
 */
function applyDerivedLimits(quote: Quote): Quote {
  if (quote.limitUp !== undefined && quote.limitDown !== undefined) return quote;
  const code = String(quote.code);
  if (isIndexCode(code)) return quote;
  if (quote.prevClose === undefined) return quote;
  const derived = computeLimitPrices(code, quote.prevClose, quote.name);
  if (!derived) return quote;
  return {
    ...quote,
    limitUp: quote.limitUp ?? derived.limitUp,
    limitDown: quote.limitDown ?? derived.limitDown
  };
}

/**
 * 解析 Eastmoney 行情 JSON：json.data.diff 数组 → Record<StockCode, Quote>。
 * fltt=2 返回浮点值（元/百分比），与 v1.3 一致直接使用；价格为 0 或非有限 → 丢弃。
 *
 * 涨停/跌停：批量接口 ulist.np/get 不提供该数据（f1–f300 实测全扫无匹配），
 * 改用逐只 stock/get 会让 500 只自选股从 1 次请求变成 500 次。v2.5.5 起
 * 主源路径的涨跌停由 applyDerivedLimits 按交易所规则推导（昨收×板块幅度，
 * 见 domain/limit-rule.ts）；腾讯备源有真值时真值优先。
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
      price: num(row.f2),
      prevClose: num(row.f18),
      change: num(row.f4),
      changePercent: num(row.f3),
      amount: num(row.f6),
      open: num(row.f17),
      high: num(row.f15),
      low: num(row.f16),
      volume: num(row.f5),
      turnoverRate: num(row.f8),
      amplitude: num(row.f7),
      volumeRatio: num(row.f10),
      pe: num(row.f9),
      pb: num(row.f23),
      totalMarketCap: num(row.f20),
      floatMarketCap: num(row.f21)
    });
    // 指数行剔除估值字段（实测东财指数 PE/PB 上报 0，渲染 0.00 是假数据）；
    // 股票行补涨跌停（批量接口不返回，按规则推导）。
    if (quote) result[code] = isIndexCode(code) ? projectIndexQuote(quote) : applyDerivedLimits(quote);
  }
  return result;
}

/** 腾讯行情响应最少需要的字段数（低于此视为哨兵行，如 v_pv_none_match）。 */
const TENCENT_MIN_FIELDS = 6;

/**
 * 取腾讯成交额（元）。
 * 优先用 [35] 的「现价/成交量/成交额」复合字段第三段——它是精确的元值，
 * 与 Eastmoney f6 口径一致；缺失时回退 [37]（万元）换算。
 */
function tencentAmount(fields: readonly string[]): number | null {
  const composite = fields[35];
  if (typeof composite === 'string' && composite.includes('/')) {
    const exact = num(composite.split('/')[2]);
    if (exact !== null) return exact;
  }
  const wan = num(fields[37]);
  return wan === null ? null : wan * 10_000;
}

/** 取腾讯市值字段（亿元）并统一换算为元，与 Eastmoney f20/f21 口径一致。 */
function tencentCap(fields: readonly string[], index: number): number | null {
  const yi = num(fields[index]);
  return yi === null ? null : yi * 100_000_000;
}

/**
 * 取腾讯涨跌停价：仅正数有效（实测指数行上报 -1 哨兵；停牌/无涨跌停约束品种同理），
 * 非正值归 null → enrichQuote 保持 undefined → 展示层渲染 `--`。
 */
function tencentLimitPrice(value: unknown): number | null {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
}

/**
 * 解析腾讯行情文本（GBK 已解码）：逐行匹配 `v_<code>="..."`，字段以 `~` 分隔。
 * 实测字段布局（88 个）：[1]=名称 [3]=现价 [4]=昨收 [31]=涨跌额 [32]=涨跌幅
 * [35]=现价/成交量/成交额复合 [37]=成交额（万元）。
 * 响应键回显带市场前缀（v_sh600519 / v_sz000001 / v_bj430047），直接小写取用。
 * price<=0（停牌/盘前）由 enrichQuote 丢弃——绝不生成模拟价格。
 * 指数行实测 88 字段（北证50 为 87），哨兵阈值 6 拦不住也不需要拦。
 */
export function parseTencent(text: string): Readonly<Record<StockCode, Quote>> {
  const result = {} as Record<StockCode, Quote>;
  for (const line of text.split('\n')) {
    const match = line.match(/v_(\w+)="([^"]*)"/);
    if (!match) continue;
    const [, responseCode, body] = match;
    const fields = body.split('~');
    if (fields.length < TENCENT_MIN_FIELDS || !fields[1]) continue;

    const code = responseCode.toLowerCase() as StockCode;
    const quote = enrichQuote({
      code,
      name: fields[1],
      price: num(fields[3]),
      prevClose: num(fields[4]),
      change: num(fields[31]),
      changePercent: num(fields[32]),
      amount: tencentAmount(fields),
      open: num(fields[5]),
      high: num(fields[33]),
      low: num(fields[34]),
      volume: num(fields[36]),
      turnoverRate: num(fields[38]),
      amplitude: num(fields[43]),
      volumeRatio: num(fields[49]),
      pe: num(fields[39]),
      pb: num(fields[46]),
      totalMarketCap: tencentCap(fields, 45),
      floatMarketCap: tencentCap(fields, 44),
      limitUp: tencentLimitPrice(fields[47]),
      limitDown: tencentLimitPrice(fields[48])
    });
    // 股票行：腾讯真值优先，[47]/[48] 缺失（哨兵被过滤）时按规则推导补齐；指数照旧剔除。
    if (quote) result[code] = isIndexCode(code) ? projectIndexQuote(quote) : applyDerivedLimits(quote);
  }
  return result;
}

/** 东财搜索有效的 SecurityType 集合（股票；指数 '5' 单独处理，见 parseEastmoneySearch）。 */
const VALID_SECURITY_TYPES = new Set(['1', '2', '25', '27']);

/**
 * 可添加的交易所指数代码段（实测见 docs/调研-大盘指数支持.md §2.3）：
 * - 000xxx：沪市指数（上证指数/上证50/沪深300/科创50/中证500…，搜索端 MktNum=1）
 * - 399xxx：深市指数（深证成指/创业板指…，搜索端 MktNum=0）
 * - 899xxx：北证指数（北证50，搜索端 Classify=34 而非 'Index'，MktNum=0）
 * 其余 SecurityType=5 条目（如 980073 生猪指数等跨市场/主题指数）不在可添加段位，拒掉。
 */
const INDEX_CODE_SEGMENTS: Readonly<Record<string, 'sh' | 'sz' | 'bj'>> = {
  '000': 'sh',
  '399': 'sz',
  '899': 'bj'
};

/**
 * 解析 Eastmoney 搜索 JSON：QuotationCodeTable.Data（或 _oma_data.QuotationCodeTable.Data）。
 * 股票过滤：SecurityType in {'1','2','25','27'} 或 (!SecurityType && Classify==='AStock')。
 * 指数过滤（v2.1）：SecurityType==='5' 且代码落在可添加指数段（000/399/899），
 * 按段位归市场——不依赖 MktNum/Classify（北证50 实测 Classify=34、MktNum=0，
 * 靠它们会把 899050 误判成深市）。
 * code 格式 6 位数字；股票前缀：27→bj, (25||1||MktNum==='1')→sh, 否则 sz。
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
    const rawCode = String(item.Code || '');
    if (!/^\d{6}$/.test(rawCode)) continue;

    // ── 指数（SecurityType=5）：仅放行交易所指数段 ──
    if (securityType === '5') {
      const segment = INDEX_CODE_SEGMENTS[rawCode.slice(0, 3)];
      if (!segment) continue;
      results.push({
        code: `${segment}${rawCode}` as StockCode,
        name: String(item.Name || rawCode),
        pinyin: String(item.PinYin || ''),
        tags: ['指数']
      });
      continue;
    }

    if (!VALID_SECURITY_TYPES.has(securityType) && !(!item.SecurityType && classify === 'AStock')) continue;
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

// ===== 历史行情（v2.2）：trends2 分时 / kline K线 =====
// 字段语义来自 2026-08-26 实网样本核对（f51/f52 教训：照字段表抄会固化错误假设）：
// trends2 行形如 `2026-08-26 09:31,1299.00,1300.42,1303.00,1295.00,926,120311019.00,1299.209`
// → f51 时间, f52 价格, f53 当日均价, f54 分钟内高, f55 分钟内低,
//   f56 成交量(手), f57 成交额(元), f58 量比权重（随时间递增的平滑特征）。
// kline 行形如 `2026-06-03,1275.98,1253.89,1275.98,1247.98,52477,6743202681.00,2.19,-1.98,-25.31,0.42`
// → f51 日期, f52 开, f53 收, f54 高, f55 低, f56 量, f57 额, f58 振幅,
//   f59 涨跌幅, f60 涨跌额, f61 换手率。

/** 解析趋势时间字符串 `yyyy-MM-dd HH:mm` → UTC 毫秒。 */
function parseTrendTime(value: string): number {
  return Date.parse(value.replace(' ', 'T') + ':00+08:00');
}

/**
 * 解析东财分时 JSON（trends2）：data.trends 数组 → TrendPoint[]。
 * 逐行按逗号切分；任一数值非法则跳过该行（防脏数据画坏曲线）。
 * 返回 null 表示响应不含 data（停牌无分时 / 请求失败时给调用方明确的空态）。
 */
export function parseEastmoneyTrends(json: unknown): readonly (import('../../domain/chart.js').TrendPoint)[] {
  const data = (json as { data?: { trends?: unknown[] } })?.data;
  const rows = data?.trends;
  if (!Array.isArray(rows)) return [];
  const points: import('../../domain/chart.js').TrendPoint[] = [];
  for (const row of rows) {
    if (typeof row !== 'string') continue;
    const parts = row.split(',');
    if (parts.length < 8) continue;
    const time = parseTrendTime(parts[0]);
    const price = num(parts[1]);
    const avgPrice = num(parts[2]);
    const high = num(parts[3]);
    const low = num(parts[4]);
    const volume = num(parts[5]);
    const amount = num(parts[6]);
    const volumeRatio = num(parts[7]);
    if (price === null || !Number.isFinite(time)) continue;
    points.push({
      time,
      price,
      avgPrice: avgPrice ?? price,
      high: high ?? price,
      low: low ?? price,
      volume: volume ?? 0,
      amount: amount ?? 0,
      volumeRatio: volumeRatio ?? 0
    });
  }
  return points;
}

/**
 * 解析东财 K线 JSON（kline/get）：data.klines 数组 → KlineBar[]。
 * 行格式同上；数值非法则跳过（不生成模拟点）。fqt=1 前复权。
 */
export function parseEastmoneyKline(json: unknown): readonly (import('../../domain/chart.js').KlineBar)[] {
  const data = (json as { data?: { klines?: unknown[] } })?.data;
  const rows = data?.klines;
  if (!Array.isArray(rows)) return [];
  const bars: import('../../domain/chart.js').KlineBar[] = [];
  for (const row of rows) {
    if (typeof row !== 'string') continue;
    const parts = row.split(',');
    if (parts.length < 11) continue;
    const date = parts[0];
    const open = num(parts[1]);
    const close = num(parts[2]);
    const high = num(parts[3]);
    const low = num(parts[4]);
    const volume = num(parts[5]);
    const amount = num(parts[6]);
    const changePercent = num(parts[8]);
    const turnoverRate = num(parts[10]);
    if (open === null || close === null || high === null || low === null) continue;
    bars.push({
      date,
      open,
      close,
      high,
      low,
      volume: volume ?? 0,
      amount: amount ?? 0,
      changePercent: changePercent ?? 0,
      turnoverRate: turnoverRate ?? 0
    });
  }
  return bars;
}
