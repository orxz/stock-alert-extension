// src/domain/formatting.ts
// 确定格式的纯函数集合。零副作用：时间通过参数传入，禁止 Date.now() / Chrome / DOM。
import type { QuoteResult } from './quote.js';
import type { Stock } from './stock.js';

const TZ = 'Asia/Shanghai';

/** 盘外最低刷新间隔（5 分钟），避免后台空跑。 */
const OFF_HOURS_INTERVAL_MS = 300_000;

/** Badge 状态：角标文本与颜色。 */
export interface BadgeState {
  readonly text: string;
  readonly color: string;
}

/**
 * 格式化时间戳为 `HH:MM`（Asia/Shanghai, h23）。
 * 与 v1.3 quote-format.js 语义一致（hour12:false ≡ hourCycle:'h23'）。
 */
export function formatTime(ts: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(ts));
}

/**
 * 格式化涨跌幅角标文本。
 * 非有限→'--'；|x|>=1000→'999'；>=100→Math.round；>=10→toFixed(0)；否则 toFixed(1)。
 */
export function formatBadge(percent: number): string {
  if (!Number.isFinite(percent)) return '--';
  const absolute = Math.abs(percent);
  if (absolute >= 1000) return '999';
  if (absolute >= 100) return Math.round(absolute).toString();
  if (absolute >= 10) return absolute.toFixed(0);
  return absolute.toFixed(1);
}

/**
 * 格式化 Badge 状态：文本 + 颜色。
 * 非有限→灰 '--'；cached→灰；fresh→正红#E74C3C / 负绿#27AE60 / 零灰。
 */
export function formatBadgeState(result: QuoteResult): BadgeState {
  const quote = result.quote;
  if (!quote) return { text: '--', color: '#95A5A6' };
  const percent = quote.changePercent;
  if (!Number.isFinite(percent)) return { text: '--', color: '#95A5A6' };
  if (result.status === 'cached') return { text: formatBadge(percent), color: '#95A5A6' };
  const color = percent > 0 ? '#E74C3C' : percent < 0 ? '#27AE60' : '#95A5A6';
  return { text: formatBadge(percent), color };
}

/**
 * 格式化 Tooltip 单行。
 * 无可用行情→`${name}  暂无行情`；正常→`${name} ${arrow} ${percent}`；
 * cached 追加 ` · 已过期 ${time}`。percent 使用 toFixed(1)（非 formatBadge）。
 */
export function formatTooltipLine(stock: Stock, result: QuoteResult): string {
  const quote = result.quote;
  if (!quote || !Number.isFinite(quote.price)) {
    return `${(stock.name || stock.code).slice(0, 6)}  暂无行情`;
  }
  const name = (quote.name || stock.name || stock.code).slice(0, 6);
  const percent = Number.isFinite(quote.changePercent) ? `${quote.changePercent.toFixed(1)}%` : '--';
  const arrow = quote.change > 0 ? '▲' : quote.change < 0 ? '▼' : '—';
  if (result.status !== 'cached') return `${name} ${arrow} ${percent}`;
  const fetchedAt = result.fetchedAt;
  const time = fetchedAt !== null && Number.isFinite(fetchedAt) ? formatTime(fetchedAt) : '--:--';
  return `${name} ${arrow} ${percent} · 已过期 ${time}`;
}

/** 格式化成交量：亿/万分级。 */
export function formatVolume(v: number): string {
  if (!v) return '0';
  if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿';
  if (v >= 10000) return (v / 10000).toFixed(1) + '万';
  return String(v);
}

/** 格式化成交额：亿/万分级。 */
export function formatAmount(v: number): string {
  if (!v) return '0';
  if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿';
  if (v >= 10000) return (v / 10000).toFixed(1) + '万';
  return v.toFixed(0);
}

/**
 * 以中国时区解析时间，用于判断 A 股交易时段。
 * 返回 weekday（短名）、hour（2 位）、minute（2 位）。
 */
export function chinaTimeParts(now: number): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(now));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/**
 * A 股交易时段判定：9:15-11:35 与 12:55-15:05（含集合竞价与收盘前缓冲）。
 * 周末返回 false。分钟区间 555-695 / 775-905。
 */
export function isChinaMarketActive(now: number): boolean {
  const parts = chinaTimeParts(now);
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return (minutes >= 555 && minutes <= 695) || (minutes >= 775 && minutes <= 905);
}

/**
 * 根据当前是否处于交易时段，决定 popup / background 的刷新间隔。
 * 盘中 background 30s / popup 10s，盘外 5 分钟。
 */
export function getRefreshIntervalMs(now: number, target: 'background' | 'popup'): number {
  if (!isChinaMarketActive(now)) return OFF_HOURS_INTERVAL_MS;
  return target === 'background' ? 30_000 : 10_000;
}
