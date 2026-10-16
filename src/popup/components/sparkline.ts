// src/popup/components/sparkline.ts
// 迷你走势图绘制（单一真相，v2.5.3 抽取）。
// 三个消费方共用：stock-table / stock-card（hover 浮层迷你分时）与
// index-strip（指数条 sparkline）——此前三处独立实现同款「面积渐变 +
// 涨跌折线 + 容器实际分辨率」，改一处漏两处；chart-detail-panel 也复用
// 本模块的涨跌色与 hexToRgba。纯 DOM/canvas 工具：不 import Store/RPC，
// 组件层内共享（同 detail-tooltip 先例）。

/** 涨跌色（与 tokens.css 的 --up/--down 一致；canvas 读不到 CSS 变量，此处为唯一副本）。 */
export const CHART_UP = '#ff5a5c';
export const CHART_DOWN = '#16c79a';
export const CHART_FLAT = '#8a8f98';

// backing store 的 width/height 已乘 DPR，不能在隐藏容器的后续重绘中再次当成
// CSS 尺寸。记录每块画布的逻辑尺寸；WeakMap 不延长虚拟滚动已移除画布的生命期。
const logicalSizes = new WeakMap<HTMLCanvasElement, { width: number; height: number }>();

/** hex 色 → rgba（渐变填充用）。 */
export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 序列首尾判色：末点高 → 涨色；低 → 跌色；平/过短 → 平色。 */
export function trendColorOf(seq: readonly number[]): string {
  if (seq.length < 2) return CHART_FLAT;
  const last = seq[seq.length - 1];
  const first = seq[0];
  return last > first ? CHART_UP : last < first ? CHART_DOWN : CHART_FLAT;
}

/** 迷你走势绘制选项。 */
export interface SparklineOptions {
  /** 覆盖序列判色（指数条跟随快照 trend 而非序列首尾）。 */
  readonly color?: string;
  /** 面积渐变顶部 alpha（默认 0.22）。 */
  readonly fillTop?: number;
  /** 面积渐变底部 alpha（默认 0.03）。 */
  readonly fillBottom?: number;
  /** 折线宽（默认 1.4）。 */
  readonly lineWidth?: number;
  /** 归一化区间中位虚线；它不代表昨收或任何真实价格基准。 */
  readonly midline?: boolean;
  /** 图形内边距，避免极值/端点裁切。省略时保留指数条的现有几何。 */
  readonly padding?: number;
  /** 标记最后一个真实数据点（不外推）。 */
  readonly endPoint?: boolean;
}

/**
 * 绘制迷你走势：面积渐变 + 涨跌色折线（+ 可选中位虚线）。
 * canvas 物理分辨率按容器实际 CSS 尺寸 × dpr 设定——固定逻辑分辨率会被
 * CSS 拉伸发糊（v2.5.1/v2.5.2 教训，详情大图同款修复）。
 * @returns 是否成功绘制（无 canvas/无 ctx/序列过短时 false，不抛错）。
 */
export function drawSparkline(
  canvas: HTMLCanvasElement | null,
  seq: readonly number[],
  options: SparklineOptions = {}
): boolean {
  if (!canvas || seq.length < 2) return false;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const rect = canvas.getBoundingClientRect();
  const previousSize = logicalSizes.get(canvas);
  const w = rect.width > 0 ? rect.width : previousSize?.width ?? canvas.width;
  const h = rect.height > 0 ? rect.height : previousSize?.height ?? canvas.height;
  logicalSizes.set(canvas, { width: w, height: h });
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  // 尺寸守卫：同尺寸跳过重设（避免重分配 backing store）。
  const targetW = Math.round(w * dpr);
  const targetH = Math.round(h * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const color = options.color ?? trendColorOf(seq);
  const padding = Math.max(0, Math.min(options.padding ?? 0, Math.max(0, Math.min(w, h) / 2 - 1)));
  const baseY = padding > 0 ? h - padding : h - 2;
  const xOf = (i: number): number => padding + ((w - padding * 2) * i) / (seq.length - 1);
  const yOf = (v: number): number => padding > 0 ? padding + (h - padding * 2) * (1 - v) : h * (1 - v) - 1.5;

  // 面积渐变（顶部 → 底部淡出）。
  ctx.beginPath();
  seq.forEach((v, i) => (i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v))));
  ctx.lineTo(xOf(seq.length - 1), baseY);
  ctx.lineTo(xOf(0), baseY);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hexToRgba(color, options.fillTop ?? 0.22));
  grad.addColorStop(1, hexToRgba(color, options.fillBottom ?? 0.03));
  ctx.fillStyle = grad;
  ctx.fill();

  // 折线。
  ctx.strokeStyle = color;
  ctx.lineWidth = options.lineWidth ?? 1.4;
  ctx.beginPath();
  seq.forEach((v, i) => (i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v))));
  ctx.stroke();

  if (options.endPoint) {
    ctx.fillStyle = color;
    ctx.fillRect(xOf(seq.length - 1) - 2, yOf(seq[seq.length - 1]) - 2, 4, 4);
  }

  // 中位虚线（可选——平走序列不画假线）。
  if (options.midline && seq.some((v) => v === 0.5)) {
    ctx.strokeStyle = 'rgba(138, 143, 152, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(xOf(0), h * 0.5);
    ctx.lineTo(xOf(seq.length - 1), h * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  return true;
}
