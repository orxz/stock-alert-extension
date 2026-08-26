// src/domain/limit-rule.ts
// 涨跌停规则推导（v2.5.5）。
//
// 背景：东财批量接口 ulist.np/get 不返回涨跌停（f51/f52 在该端点是无关量纲，
// 实测见 docs/调研-大盘指数支持.md），而 QuoteService 只在主源缺失时才调
// 腾讯备源——主源成功的股票永远拿不到腾讯的涨跌停真值，展示层长期 `--`。
//
// 修复策略：**真值优先，规则推导兜底**。涨跌停是交易所制度的确定性公式
// （昨收 × 板块幅度，四舍五入到分）——不是模拟行情：同一昨收必然得到同一
// 结果，可独立复算验证。腾讯 [47]/[48] 有真值时用真值；主源路径（或腾讯
// 停牌 0/-1 哨兵被过滤后）缺失时按本模块规则补齐。
//
// 规则表（2026 现行）：
// - 沪深主板（60x / 00x 非创业）：±10%；ST 及风险警示（名称前缀 ST/*ST/S*ST/SST）：±5%
// - 创业板（30x）：±20%（2020-08-24 注册制改革后，ST 同幅度）
// - 科创板（688/689）：±20%（ST 同幅度）
// - 北交所（4x/8x/92x）：±30%（ST 同幅度）
// - 指数（sh000/sz399/bj899）：不适用——projectIndexQuote 已剔除，本模块也防御性跳过
//
// 已知边界（推导值标为规则参考）：新股上市首日（主板 ±44%/-36%、创业/科创
// 前 5 日无限制、北交首日无限制）无法从代码段判断是否首日——首日推导值会
// 偏小，但首日股票不显示涨跌停本就是少数场景；四舍五入按交易所「至 0.01 元」
// 用整数分运算 + epsilon 防浮点下偏。
import type { StockCode } from './brands.js';
import { isIndexCode } from './stock.js';

/** 涨跌停幅度（小数：0.10 = ±10%）。 */
export type LimitPct = number;

/** ST/风险警示名称前缀（A 股 ST 标记都在名称头部；用 startsWith 防止误伤含 ST 字样的正常名）。 */
const ST_PREFIXES = ['*ST', 'S*ST', 'SST', 'ST'] as const;

/** 判断名称是否为 ST/风险警示股。 */
export function isStName(name: string | undefined): boolean {
  if (!name) return false;
  const upper = name.toUpperCase();
  return ST_PREFIXES.some((p) => upper.startsWith(p));
}

/**
 * 按代码段判定涨跌停幅度。
 * - 北交所（bj 4x/8x/92x，含 920 新段）：±30%
 * - 创业板（sz 30x）：±20%
 * - 科创板（sh 688/689）：±20%
 * - 沪深主板：±10%，ST ±5%
 * 指数代码返回 null（不适用）。
 */
export function limitPctFor(code: string, name?: string): LimitPct | null {
  if (isIndexCode(code)) return null;
  const lower = String(code).toLowerCase();
  if (lower.startsWith('bj')) return 0.3;
  if (lower.startsWith('sz3')) return 0.2;
  if (lower.startsWith('sh68')) return 0.2;
  // 主板：ST 风险警示 ±5%，其余 ±10%。
  return isStName(name) ? 0.05 : 0.1;
}

/**
 * 推导涨跌停价：昨收 × (1 ± pct)，四舍五入到分。
 * 昨收非法（≤0/非有限）或幅度不适用（指数）返回 null。
 */
export function computeLimitPrices(
  code: string,
  prevClose: number | undefined,
  name?: string
): { limitUp: number; limitDown: number } | null {
  if (prevClose === undefined || !Number.isFinite(prevClose) || prevClose <= 0) return null;
  const pct = limitPctFor(code, name);
  if (pct === null) return null;
  // 整数分运算 + 1e-4 epsilon 防浮点表示下偏（如 1304*1.1 = 1434.4000000000002，
  // 而 13.05*1.1 = 14.354999999999999 会误舍成 14.35 而非 14.36）。
  const upCents = Math.round(prevClose * 100 * (1 + pct) + 1e-4);
  const downCents = Math.round(prevClose * 100 * (1 - pct) + 1e-4);
  return {
    limitUp: upCents / 100,
    limitDown: downCents / 100
  };
}
