// 悬停分时呈现：卡片/列表共享骨架、状态、真实读数和完整分钟序列。
// 只负责同步展示；异步请求、缓存与失效仍由消费者管理。
import { isUsableTrends, type TrendPoint } from '../../domain/chart.js';
import { CHART_UP, CHART_DOWN, CHART_FLAT, drawSparkline } from './sparkline.js';

export interface MiniTrendsOptions { readonly priceHidden: boolean }
export type MiniTrendsStatus = 'loading' | 'error' | 'empty';
const CHINA_OFFSET = 8 * 60 * 60 * 1000;
const STATUS_TEXT: Readonly<Record<MiniTrendsStatus, string>> = {
  loading: '分时加载中…',
  error: '分时加载失败，移开后重试',
  empty: '暂无分时数据，移开后重试'
};

/** 消费者决定何时显示（默认隐藏，避免未启用悬停时占位）。 */
export function createMiniTrends(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'detail-mini-wrap';
  wrap.hidden = true;
  const header = document.createElement('div');
  header.className = 'detail-mini-header detail-mini-meta';
  const title = document.createElement('span');
  title.textContent = '分时走势';
  const price = document.createElement('strong');
  price.dataset.field = 'mini-price';
  header.append(title, price);
  const canvas = document.createElement('canvas');
  canvas.className = 'detail-mini-trends';
  canvas.width = 260;
  canvas.height = 88;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '分时走势图');
  const meta = document.createElement('div');
  meta.className = 'detail-mini-meta detail-mini-times';
  const start = document.createElement('span');
  start.dataset.field = 'mini-start';
  const end = document.createElement('span');
  end.dataset.field = 'mini-end';
  meta.append(start, end);
  const status = document.createElement('div');
  status.className = 'detail-mini-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  wrap.append(header, canvas, status, meta);
  return wrap;
}

/** 状态有明确说明；清理已过时的价格/画布，避免新股票展示上一次的走势。 */
export function setMiniTrendsStatus(wrap: HTMLElement, state: MiniTrendsStatus): void {
  wrap.hidden = false;
  wrap.dataset.state = state;
  wrap.setAttribute('aria-busy', String(state === 'loading'));
  const canvas = wrap.querySelector<HTMLCanvasElement>('.detail-mini-trends');
  if (canvas) {
    canvas.hidden = true;
    canvas.setAttribute('aria-label', STATUS_TEXT[state]);
  }
  for (const field of wrap.querySelectorAll<HTMLElement>('[data-field]')) field.textContent = '';
  const status = wrap.querySelector<HTMLElement>('.detail-mini-status');
  if (status) { status.hidden = false; status.textContent = STATUS_TEXT[state]; }
}

/** 显示全部真实分钟点；归一化仅用于坐标，不抽样、不插值、不伪造昨收。 */
export function renderMiniTrends(wrap: HTMLElement, points: readonly TrendPoint[], options: MiniTrendsOptions): void {
  if (!isUsableTrends(points) || points.some((point) => !Number.isFinite(new Date(point.time + CHINA_OFFSET).getTime()))) {
    setMiniTrendsStatus(wrap, 'empty');
    return;
  }
  const canvas = wrap.querySelector<HTMLCanvasElement>('.detail-mini-trends');
  if (!canvas) { setMiniTrendsStatus(wrap, 'error'); return; }
  // 必须先显示，再读取实际容器尺寸；隐藏时测量会落入属性宽高回退并被 CSS 拉伸。
  wrap.hidden = false;
  canvas.hidden = false;
  const status = wrap.querySelector<HTMLElement>('.detail-mini-status');
  if (status) { status.hidden = true; status.textContent = ''; }
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const normalized = prices.map((price) => max === min ? 0.5 : (price - min) / (max - min));
  const first = points[0];
  const last = points[points.length - 1];
  const direction = last.price > first.price ? 'up' : last.price < first.price ? 'down' : 'flat';
  const theme = window.getComputedStyle(wrap);
  const color = theme.getPropertyValue(direction === 'up' ? '--up' : direction === 'down' ? '--down' : '--text-3').trim()
    || (direction === 'up' ? CHART_UP : direction === 'down' ? CHART_DOWN : CHART_FLAT);
  const drawn = drawSparkline(canvas, normalized, { color, padding: 6, endPoint: true, lineWidth: 1.8, fillTop: 0.18, fillBottom: 0 });
  if (!drawn) { setMiniTrendsStatus(wrap, 'error'); return; }
  wrap.dataset.state = 'ready';
  wrap.dataset.trend = direction;
  wrap.setAttribute('aria-busy', 'false');
  wrap.style.setProperty('--mini-trend-color', color);
  const price = wrap.querySelector<HTMLElement>('[data-field="mini-price"]');
  const displayedPrice = options.priceHidden ? '****' : last.price.toFixed(2);
  if (price) { price.textContent = displayedPrice; price.style.color = color; }
  const start = new Date(first.time + CHINA_OFFSET).toISOString().slice(11, 16);
  const end = new Date(last.time + CHINA_OFFSET).toISOString().slice(11, 16);
  const startEl = wrap.querySelector<HTMLElement>('[data-field="mini-start"]');
  const endEl = wrap.querySelector<HTMLElement>('[data-field="mini-end"]');
  if (startEl) startEl.textContent = start;
  if (endEl) endEl.textContent = end;
  canvas.setAttribute('aria-label', `分时走势，${start}至${end}，最新价${displayedPrice}`);
}
