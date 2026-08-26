// src/popup/components/chart-detail-panel.ts
// 详情面板组件（v2.2）：点击行情行/卡片打开——分时图 + 日/周/月K线 + 指标。
// Light DOM + Canvas 自绘（零第三方依赖，符合 MV3 CSP 'self' 与包体门槛）。
// 架构约束：组件自治——自己发 chart:load RPC（经注入的 loader）、自己持有
// loading/error/data 三态；不访问 Store/RPC 基础设施，只消费 DetailPanelViewModel
// 的开关状态 + 注入的 fetch 函数。
import type { DetailPanelViewModel } from '../view-models.js';
import type { ChartData, ChartKind, KlinePeriod, KlineBar, TrendPoint } from '../../domain/chart.js';
import { emitPopupEvent } from './events.js';
import { CHART_UP, CHART_DOWN, CHART_FLAT, hexToRgba } from './sparkline.js';

/** 图表拉取函数（由 AppShell 注入——生产为 RPC chart:load，测试为 mock）。 */
export type ChartLoader = (code: string, kind: ChartKind, period: KlinePeriod) => Promise<ChartData>;

/** Canvas 内边距：左侧留给价格轴，底部给时间轴。 */
const PAD_LEFT = 44;
const PAD_RIGHT = 48; // 右侧留给出最新价标签
const PAD_TOP = 10;
const PAD_BOTTOM = 18;

/** 逻辑分辨率（v2.5：高度 240 回退默认；实际按容器尺寸）。 */
const VIEW_W = 320;
const VIEW_H = 240;

/** 量能副图与主图的分隔间隙。 */
const VOLUME_GAP = 8;

/** 网格/文字色（图表专用，不入 sparkline——迷你图不用网格）。 */
const GRID = 'rgba(128, 132, 142, 0.18)';
const TEXT = '#8a8f98';
const VOLUME_BAR_W = 2;

export class ChartDetailPanelElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: DetailPanelViewModel | null = null;
  private _loader: ChartLoader | null = null;
  private _data: ChartData | null = null;
  private _error: string | null = null;
  private _loading = false;
  private _kind: ChartKind = 'trends';
  private _period: KlinePeriod = 'day';

  private titleEl: HTMLElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private tabEls: HTMLElement[] = [];
  private closeBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private metricsEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** 当前渲染的几何缓存（十字光标反查用）：points/bars + xAt/yAt。 */
  private _geo: {
    kind: 'trends' | 'kline';
    points: readonly TrendPoint[] | null;
    bars: readonly KlineBar[] | null;
    xAt: (i: number) => number;
    yAt: (v: number) => number;
  } | null = null;
  /** 当前逻辑视口尺寸（随容器实际大小；默认回退 320×240）。 */
  private _vw = VIEW_W;
  private _vh = VIEW_H;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    const signal = this.connection.signal;
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    this.bindEvents(signal);
    // 面板/容器尺寸变化时重绘（canvas 分辨率按实际容器尺寸设定，不重绘会残留拉伸）。
    if (typeof ResizeObserver !== 'undefined' && this.canvasEl) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this._data || this._error) this.render();
      });
      this.resizeObserver.observe(this.canvasEl);
    }
    if (this._viewModel) this.applyViewModel(this._viewModel);
  }

  disconnectedCallback(): void {
    this.connection?.abort();
    this.connection = undefined;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  get viewModel(): DetailPanelViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: DetailPanelViewModel) {
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value);
  }

  /** 注入图表加载函数（AppShell 在创建时调用）。 */
  setLoader(loader: ChartLoader | null): void {
    this._loader = loader;
  }

  private buildSkeleton(): void {
    this.className = 'chart-detail-panel';
    this.setAttribute('data-region', 'detail-panel');
    this.setAttribute('hidden', '');

    const toolbar = document.createElement('div');
    toolbar.className = 'detail-toolbar';

    const title = document.createElement('div');
    title.className = 'detail-title';
    title.setAttribute('data-region', 'detail-title');
    this.titleEl = title;

    // 形态切换：分时 / 日K / 周K / 月K（radio-group 语义，不占 tablist 角色——
    // popup 已有分组标签用 tablist，详情面板再抢 role 会撞既有 e2e 的 [role=tablist] 选择器）。
    const tabGroup = document.createElement('div');
    tabGroup.className = 'detail-tabs';
    tabGroup.setAttribute('role', 'group');
    tabGroup.setAttribute('aria-label', '图表形态');
    const tabs: ReadonlyArray<readonly [ChartKind | KlinePeriod, string]> = [
      ['trends', '分时'],
      ['day', '日K'],
      ['week', '周K'],
      ['month', '月K']
    ];
    for (const [key, label] of tabs) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'detail-tab';
      tab.setAttribute('aria-pressed', String(key === 'trends'));
      tab.dataset.chartKey = String(key);
      tab.textContent = label;
      tabGroup.append(tab);
      this.tabEls.push(tab);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'detail-close-btn';
    closeBtn.setAttribute('data-action', 'detail-close');
    closeBtn.setAttribute('aria-label', '关闭详情面板');
    closeBtn.textContent = '✕';
    this.closeBtn = closeBtn;

    toolbar.append(title, tabGroup, closeBtn);

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'detail-canvas-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'detail-canvas';
    canvas.setAttribute('aria-label', '行情图表');
    canvasWrap.append(canvas);
    this.canvasEl = canvas;

    const status = document.createElement('div');
    status.className = 'detail-status';
    status.setAttribute('data-region', 'detail-status');
    status.setAttribute('hidden', '');
    this.statusEl = status;

    // 指标区（分时/ K线共用的关键指标一行）。
    const metrics = document.createElement('div');
    metrics.className = 'detail-metrics';
    metrics.setAttribute('data-region', 'detail-metrics');
    this.metricsEl = metrics;

    this.append(toolbar, canvasWrap, status, metrics);
  }

  private bindEvents(signal: AbortSignal): void {
    this.closeBtn?.addEventListener('click', () => {
      emitPopupEvent(this, 'detail-close-request', {});
    }, { signal });

    for (const tab of this.tabEls) {
      tab.addEventListener('click', () => {
        const key = tab.dataset.chartKey as ChartKind | KlinePeriod;
        const kind: ChartKind = key === 'trends' ? 'trends' : 'kline';
        const period: KlinePeriod = kind === 'kline' ? (key as KlinePeriod) : 'day';
        this._kind = kind;
        this._period = period;
        this.syncTabs();
        void this.loadChart();
      }, { signal });
    }

    // 十字光标：hover 显示十字线 + 读数（重绘当前图并叠加光标层）。
    this.canvasEl?.addEventListener('mousemove', (e) => this.onCanvasMove(e as MouseEvent), { signal });
    this.canvasEl?.addEventListener('mouseleave', () => this.onCanvasLeave(), { signal });
  }

  /** 反查光标所在索引（分时：时间下标；K线：bar 下标）。 */
  private indexAt(mouseX: number): number {
    const geo = this._geo;
    if (!geo) return -1;
    const rect = this.canvasEl?.getBoundingClientRect();
    if (!rect) return -1;
    // CSS 拉伸：逻辑 x = (鼠标 - 左) / 宽 * 当前视口宽。
    const logicalX = ((mouseX - rect.left) / rect.width) * this._vw;
    const len = geo.kind === 'trends' ? geo.points?.length ?? 0 : geo.bars?.length ?? 0;
    if (len < 2) return -1;
    const i = Math.round(((logicalX - PAD_LEFT) / (this._vw - PAD_LEFT - PAD_RIGHT)) * (len - 1));
    return Math.max(0, Math.min(len - 1, i));
  }

  private onCanvasMove(e: MouseEvent): void {
    const geo = this._geo;
    const data = this._data;
    if (!geo || !data) return;
    const idx = this.indexAt(e.clientX);
    if (idx < 0) return;
    this.render(); // 基线重绘
    const canvas = this.canvasEl;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = geo.xAt(idx);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, PAD_TOP);
    ctx.lineTo(x, this._vh - PAD_BOTTOM);
    ctx.stroke();
    ctx.setLineDash([]);
    // 读数（顶部左，白底黑字小徽章）。
    let text = '';
    if (geo.kind === 'trends' && geo.points) {
      const p = geo.points[idx];
      text = `${this.timeLabel(p.time)} 价 ${p.price.toFixed(2)} 均 ${p.avgPrice.toFixed(2)}`;
    } else if (geo.bars) {
      const b = geo.bars[idx];
      text = `${b.date} 开${b.open.toFixed(2)} 收${b.close.toFixed(2)} 高${b.high.toFixed(2)} 低${b.low.toFixed(2)}`;
    }
    if (text) {
      ctx.font = '9px sans-serif';
      const tw = ctx.measureText(text).width + 12;
      const bx = Math.min(Math.max(PAD_LEFT, x - tw / 2), this._vw - PAD_RIGHT - tw);
      ctx.fillStyle = 'rgba(20,24,32,0.92)';
      ctx.fillRect(bx, PAD_TOP + 2, tw, 16);
      ctx.fillStyle = '#e8eaf0';
      ctx.textAlign = 'left';
      ctx.fillText(text, bx + 6, PAD_TOP + 13);
    }
  }

  private onCanvasLeave(): void {
    this.render(); // 清除光标叠加
  }

  private applyViewModel(vm: DetailPanelViewModel): void {
    if (vm.open && vm.code) {
      this.removeAttribute('hidden');
      if (this.titleEl) this.titleEl.textContent = vm.name;
      if (this._data?.code !== vm.code) {
        // 换标的：清旧数据，重新拉取（目录指数/自选股都可能进详情）。
        this._data = null;
        this._error = null;
        this._kind = 'trends';
        this._period = 'day';
        this.syncTabs();
        void this.loadChart();
      }
    } else {
      this.setAttribute('hidden', '');
    }
  }

  private syncTabs(): void {
    const active = this._kind === 'trends' ? 'trends' : this._period;
    for (const tab of this.tabEls) {
      const selected = tab.dataset.chartKey === active;
      tab.setAttribute('aria-pressed', String(selected));
      tab.classList.toggle('is-active', selected);
    }
  }

  private async loadChart(): Promise<void> {
    const vm = this._viewModel;
    if (!vm || !vm.code || !this._loader) return;
    this._loading = true;
    this._error = null;
    this.renderStatus('加载中…');
    try {
      const data = await this._loader(vm.code, this._kind, this._period);
      if (this._viewModel?.code !== vm.code) return; // 已经切换标的，丢弃旧响应
      this._data = data;
      this.renderStatus('');
      this.render();
    } catch {
      if (this._viewModel?.code !== vm.code) return;
      this._data = null;
      this._error = '加载失败';
      this.renderStatus('加载失败，点击重试');
      // 失败也渲染空态（DPR 适配 + 「暂无数据」占位——否则 canvas 停在 HTML 默认 300×150）。
      this.render();
    } finally {
      this._loading = false;
    }
  }

  private renderStatus(text: string): void {
    if (!this.statusEl) return;
    if (text) {
      this.statusEl.textContent = text;
      this.statusEl.removeAttribute('hidden');
    } else {
      this.statusEl.setAttribute('hidden', '');
    }
  }

  private render(): void {
    if (!this.canvasEl) return;
    const data = this._data;
    const canvas = this.canvasEl;
    // 关键（v2.5.1）：按容器**实际** CSS 尺寸设定 canvas 分辨率——此前固定 320×240
    // 被 width:100%/height:100% 拉伸到 ~390px 容器，所有线条/文字被拉伸发糊（「像拉伸」的根因）。
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width > 0 ? rect.width : VIEW_W;
    const cssH = rect.height > 0 ? rect.height : VIEW_H;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this._vw = cssW;
    this._vh = cssH;
    // 尺寸守卫：仅尺寸变化时才重设 canvas.width/height——赋值会重分配 backing
    // store 并清屏；十字光标每次 mousemove 都全量重绘，无条件赋值会持续 GC 压力。
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!data) {
      this.renderEmpty(ctx);
      return;
    }
    if (data.kind === 'trends' && data.trends) {
      this.renderTrends(ctx, data.trends, data.prevClose);
    } else if (data.klines) {
      this.renderKlines(ctx, data.klines);
    }
  }

  private renderEmpty(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = TEXT;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无数据', this._vw / 2, this._vh / 2);
  }

  /** 主图绘图区高度（不含量能副图）。 */
  private plotHeight(): number {
    return this._vh - this.volumeH() - VOLUME_GAP - PAD_TOP - PAD_BOTTOM;
  }

  /** 量能副图顶部 y。 */
  private volumeTop(): number {
    return PAD_TOP + this.plotHeight() + VOLUME_GAP;
  }

  /**
   * 量能副图高度（v2.5.4）：总高的 22%，钳制 48..96px——取代固定 40px。
   * 大屏（容器实际 ~448px）下量能区间达 ~96px，柱形对比更清晰；
   * 小屏/回退 240px 时至少 48px，不至压缩主图。
   */
  private volumeH(): number {
    return Math.max(48, Math.min(96, Math.round(this._vh * 0.22)));
  }

  /** 分时：主图（价格线 + 昨收基准 + 均价 + 面积）+ 量能副图 + 时间轴中间刻度。 */
  private renderTrends(
    ctx: CanvasRenderingContext2D,
    trends: readonly TrendPoint[],
    prevClose?: number
  ): void {
    const w = this._vw - PAD_LEFT - PAD_RIGHT;
    const h = this.plotHeight();
    const volTop = this.volumeTop();
    const min = Math.min(...trends.map((t) => Math.min(t.price, t.low)));
    const max = Math.max(...trends.map((t) => Math.max(t.price, t.high)));
    const range = max - min || 1;
    const xAt = (i: number): number => PAD_LEFT + (w * i) / (trends.length - 1);
    const yAt = (v: number): number => PAD_TOP + h * (1 - (v - min) / range);
    this._geo = { kind: 'trends', points: trends, bars: null, xAt, yAt };
    // 量能最大柱（归一化柱高）。
    const maxVol = Math.max(...trends.map((t) => t.volume), 1);

    this.drawGrid(ctx, w, h, PAD_LEFT, yAt(min), yAt(max), min, max);
    this.drawTimeAxis(ctx, trends, xAt(0), w);
    this.drawVolumeAxis(ctx, volTop, maxVol);

    // 昨收基准线（虚线）。
    if (prevClose && prevClose >= min && prevClose <= max) {
      ctx.strokeStyle = TEXT;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, yAt(prevClose));
      ctx.lineTo(PAD_LEFT + w, yAt(prevClose));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 价格线与渐变面积填充（涨跌色：收盘=最后一点 vs 昨收）。
    const lineColor = this.colorFor(trends[trends.length - 1].price, prevClose ?? trends[0].price);
    const baseY = prevClose !== undefined ? yAt(prevClose) : yAt(min);
    ctx.beginPath();
    trends.forEach((t, i) => {
      const x = xAt(i);
      const y = yAt(t.price);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(xAt(trends.length - 1), baseY);
    ctx.lineTo(xAt(0), baseY);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + h);
    grad.addColorStop(0, hexToRgba(lineColor, 0.22));
    grad.addColorStop(1, hexToRgba(lineColor, 0.02));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    trends.forEach((t, i) => {
      const x = xAt(i);
      const y = yAt(t.price);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 均价线（细橙，参考）。
    ctx.strokeStyle = 'rgba(255, 176, 32, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    trends.forEach((t, i) => {
      const x = xAt(i);
      const y = yAt(t.avgPrice);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 量能柱（逐分钟 2px 柱；区间高度按总高 22% 动态分配，柱顶留 6px 余量）。
    const volH = this.volumeH();
    ctx.lineWidth = 1;
    for (let i = 0; i < trends.length; i++) {
      const t = trends[i];
      if (t.volume <= 0) continue;
      const x = xAt(i);
      const barH = (t.volume / maxVol) * (volH - 6);
      const color = this.colorFor(t.price, prevClose ?? t.avgPrice);
      ctx.fillStyle = hexToRgba(color, 0.55);
      ctx.fillRect(x - VOLUME_BAR_W / 2, volTop + (volH - 6) - barH, VOLUME_BAR_W, barH);
    }

    // 最新价虚线 + 右侧标签。
    const last = trends[trends.length - 1];
    const lastY = yAt(last.price);
    ctx.strokeStyle = hexToRgba(lineColor, 0.5);
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, lastY);
    ctx.lineTo(PAD_LEFT + w, lastY);
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawPriceTag(ctx, last.price, lastY, lineColor);
  }

  /** K线：蜡烛 + 5/10/20 均线 + 量能副图 + 日期轴中间刻度。 */
  private renderKlines(ctx: CanvasRenderingContext2D, klines: readonly KlineBar[]): void {
    const bars = klines.slice(-60);
    const w = this._vw - PAD_LEFT - PAD_RIGHT;
    const h = this.plotHeight();
    const volTop = this.volumeTop();
    const kVolH = this.volumeH();
    const min = Math.min(...bars.map((b) => b.low));
    const max = Math.max(...bars.map((b) => b.high));
    const range = max - min || 1;
    const step = w / bars.length;
    const bodyW = Math.max(2, step * 0.62);
    const yAt = (v: number): number => PAD_TOP + h * (1 - (v - min) / range);
    this._geo = {
      kind: 'kline',
      points: null,
      bars,
      xAt: (i: number): number => PAD_LEFT + step * i + step / 2,
      yAt
    };
    const maxVol = Math.max(...bars.map((b) => b.volume), 1);

    this.drawGrid(ctx, w, h, PAD_LEFT, yAt(min), yAt(max), min, max);
    this.drawDateAxis(ctx, bars, PAD_LEFT, step, w);
    this.drawVolumeAxis(ctx, volTop, maxVol);

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const x = PAD_LEFT + step * i + step / 2;
      const up = bar.close >= bar.open;
      const color = up ? CHART_UP : CHART_DOWN;
      const top = yAt(Math.max(bar.open, bar.close));
      const bottom = yAt(Math.min(bar.open, bar.close));
      // 影线（统一上下影）。
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yAt(bar.high));
      ctx.lineTo(x, yAt(bar.low));
      ctx.stroke();
      // 实体：涨=空心（红边），跌=实心（绿）——经典蜡烛图，涨跌一眼可辨。
      if (up) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - bodyW / 2, top, bodyW, Math.max(1, bottom - top));
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(x - bodyW / 2, top, bodyW, Math.max(1, bottom - top));
      }

      // 量能柱（涨跌色，透明度降噪；区间高度按总高 22% 动态分配）。
      const volBarH = (bar.volume / maxVol) * (kVolH - 6);
      ctx.fillStyle = hexToRgba(color, 0.55);
      ctx.fillRect(x - VOLUME_BAR_W / 2, volTop + (kVolH - 6) - volBarH, VOLUME_BAR_W, volBarH);
    }

    // 5/10/20 日均线 + 图例。
    this.drawMa(ctx, bars, 5, yAt, step, PAD_LEFT, '#ffb020');
    this.drawMa(ctx, bars, 10, yAt, step, PAD_LEFT, '#4ea1ff');
    this.drawMa(ctx, bars, 20, yAt, step, PAD_LEFT, '#c06ee0');
    this.drawMaLegend(ctx, bars);

    // 最新收盘价虚线 + 右侧标签。
    const last = bars[bars.length - 1];
    const lastY = yAt(last.close);
    const lastColor = this.colorFor(last.close, last.open);
    ctx.strokeStyle = hexToRgba(lastColor, 0.5);
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, lastY);
    ctx.lineTo(PAD_LEFT + w, lastY);
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawPriceTag(ctx, last.close, lastY, lastColor);
  }

  /** 均线图例：MA5/MA10/MA20 色点 + 当前值（左对齐绘制区顶部内侧，防溢出截断）。 */
  private drawMaLegend(ctx: CanvasRenderingContext2D, bars: readonly KlineBar[]): void {
    const avg = (n: number): number => {
      const slice = bars.slice(-n);
      return slice.reduce((s, b) => s + b.close, 0) / slice.length;
    };
    const items: ReadonlyArray<readonly [string, string, number]> = [
      ['MA5', '#ffb020', avg(5)],
      ['MA10', '#4ea1ff', avg(10)],
      ['MA20', '#c06ee0', avg(20)]
    ];
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    let x = PAD_LEFT + 4;
    for (const [label, color, value] of items) {
      const text = `${label} ${value.toFixed(2)}`;
      ctx.fillStyle = color;
      ctx.fillText(text, x, PAD_TOP + 10);
      x += ctx.measureText(text).width + 10;
    }
  }

  private drawMa(
    ctx: CanvasRenderingContext2D,
    bars: readonly KlineBar[],
    n: number,
    yAt: (v: number) => number,
    step: number,
    baseX: number,
    color: string
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    for (let i = n - 1; i < bars.length; i++) {
      const avg = bars.slice(i - n + 1, i + 1).reduce((s, b) => s + b.close, 0) / n;
      const x = baseX + step * i + step / 2;
      const y = yAt(avg);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  /** 时间轴刻度（4 档中间点 + 首尾），在量能副图下方。 */
  private drawTimeAxis(ctx: CanvasRenderingContext2D, trends: readonly TrendPoint[], baseX: number, w: number): void {
    ctx.fillStyle = TEXT;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    const bottom = this._vh - 4;
    const marks = [0, Math.floor(trends.length / 3), Math.floor((trends.length * 2) / 3), trends.length - 1];
    for (const idx of marks) {
      const x = baseX + (w * idx) / (trends.length - 1);
      ctx.fillText(this.timeLabel(trends[idx].time), x, bottom);
    }
  }

  /** 日期轴刻度（首/中/尾）。 */
  private drawDateAxis(ctx: CanvasRenderingContext2D, bars: readonly KlineBar[], baseX: number, step: number, w: number): void {
    ctx.fillStyle = TEXT;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    const bottom = this._vh - 4;
    const marks = [0, Math.floor(bars.length / 2), bars.length - 1];
    for (const idx of marks) {
      const x = baseX + step * idx + step / 2;
      ctx.fillText(bars[idx].date.slice(5), x, bottom); // MM-DD
    }
  }

  /** 量能副图分隔线 + 最大量标签（左上角——区间加高后的量纲锚点）。 */
  private drawVolumeAxis(ctx: CanvasRenderingContext2D, volTop: number, maxVol: number): void {
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, volTop);
    ctx.lineTo(this._vw - PAD_RIGHT, volTop);
    ctx.stroke();
    if (maxVol > 0) {
      ctx.fillStyle = TEXT;
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`量 ${this.formatVolume(maxVol)}`, PAD_LEFT + 4, volTop + 10);
    }
  }

  /** 量格式化：≥1万手 → X.X万手（量能单位为手）。 */
  private formatVolume(v: number): string {
    return v >= 10_000 ? `${(v / 10_000).toFixed(1)}万手` : `${Math.round(v)}手`;
  }

  /** 最新价标签（右侧轴带）。 */
  private drawPriceTag(ctx: CanvasRenderingContext2D, price: number, y: number, color: string): void {
    ctx.fillStyle = color;
    ctx.fillRect(this._vw - PAD_RIGHT, y - 7, PAD_RIGHT, 14);
    ctx.fillStyle = '#ffffff';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.formatAxisPrice(price), this._vw - PAD_RIGHT / 2, y + 3);
  }

  /** 网格 + 价格轴刻度（左轴 5 档，中上/中下各留一个刻度值——行情软件的轴密度）。 */
  private drawGrid(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    baseX: number,
    topY: number,
    bottomY: number,
    min?: number,
    max?: number
  ): void {
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    const rows = 4;
    for (let i = 1; i < rows; i++) {
      const y = topY + ((bottomY - topY) * i) / rows;
      ctx.beginPath();
      ctx.moveTo(baseX, y);
      ctx.lineTo(baseX + w, y);
      ctx.stroke();
    }
    // 左轴价格刻度（5 档：最高/3/4 点/最低）。
    if (min !== undefined && max !== undefined) {
      ctx.fillStyle = TEXT;
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'right';
      for (let i = 0; i <= rows; i++) {
        const value = min + ((max - min) * i) / rows;
        const y = bottomY - ((bottomY - topY) * i) / rows + 3;
        ctx.fillText(this.formatAxisPrice(value), baseX - 4, y);
      }
    }
  }

  /** 轴价格格式化：千位以上不加小数（点位/高价股），低价保留 2 位。 */
  private formatAxisPrice(v: number): string {
    return v >= 1000 ? v.toFixed(0) : v.toFixed(2);
  }

  private colorFor(current: number, base: number): string {
    if (current > base) return CHART_UP;
    if (current < base) return CHART_DOWN;
    return CHART_FLAT;
  }

  private timeLabel(time: number): string {
    const d = new Date(time);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}
