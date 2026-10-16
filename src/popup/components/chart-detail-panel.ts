// 点击行情行/卡片打开的分时与 K 线详情；只消费 ViewModel 和注入的 loader。
// Canvas 负责图形，DOM 负责图例与读数，避免长读数覆盖图形或溢出弹窗。
import type { DetailPanelViewModel } from '../view-models.js';
import type { ChartData, ChartKind, KlinePeriod, KlineBar, TrendPoint } from '../../domain/chart.js';
import { isUsableKlines, isUsableTrends } from '../../domain/chart.js';
import { emitPopupEvent } from './events.js';
import { CHART_UP, CHART_DOWN, CHART_FLAT, hexToRgba } from './sparkline.js';

export type ChartLoader = (code: string, kind: ChartKind, period: KlinePeriod) => Promise<ChartData>;

const PAD_LEFT = 50;
const PAD_RIGHT = 50;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;
const VIEW_W = 320;
const VIEW_H = 240;
const VOLUME_GAP = 20;
const GRID = 'rgba(128, 132, 142, 0.18)';
const TEXT = '#8a8f98';
const MA_COLORS = ['#ffb020', '#4ea1ff', '#c06ee0'] as const;
const MA_PERIODS = [5, 10, 20] as const;
const CHINA_OFFSET = 8 * 60 * 60 * 1000;

type Geometry = {
  kind: ChartKind;
  points: readonly TrendPoint[] | null;
  bars: readonly KlineBar[] | null;
  xAt: (i: number) => number;
  yAt: (value: number) => number;
};

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
  private _code: string | null = null;
  /** 同一标的不同周期也必须隔离；关面板/卸载会使在途请求失效。 */
  private requestVersion = 0;
  private activeIndex: number | null = null;
  private returnFocus: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private tabEls: HTMLButtonElement[] = [];
  private closeBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private legendEl: HTMLElement | null = null;
  private metricsEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private _geo: Geometry | null = null;
  private _vw = VIEW_W;
  private _vh = VIEW_H;
  private textColor = TEXT;
  private upColor: string = CHART_UP;
  private downColor: string = CHART_DOWN;
  private flatColor: string = CHART_FLAT;
  private priceLabelColor = '#11151c';

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    this.bindEvents(this.connection.signal);
    if (typeof ResizeObserver !== 'undefined' && this.canvasEl) {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.hidden) this.render();
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
    this.requestVersion++;
    this._loading = false;
  }

  get viewModel(): DetailPanelViewModel | null { return this._viewModel; }

  set viewModel(value: DetailPanelViewModel) {
    this._viewModel = value;
    if (this.isConnected) this.applyViewModel(value);
  }

  setLoader(loader: ChartLoader | null): void { this._loader = loader; }

  private buildSkeleton(): void {
    this.className = 'chart-detail-panel';
    this.setAttribute('data-region', 'detail-panel');
    this.setAttribute('aria-label', '行情走势详情');
    this.hidden = true;
    const toolbar = document.createElement('div');
    toolbar.className = 'detail-toolbar';
    const title = document.createElement('div');
    title.className = 'detail-title';
    title.dataset.region = 'detail-title';
    this.titleEl = title;
    const tabGroup = document.createElement('div');
    tabGroup.className = 'detail-tabs';
    tabGroup.setAttribute('role', 'group');
    tabGroup.setAttribute('aria-label', '图表形态');
    for (const [key, label] of [['trends', '分时'], ['day', '日K'], ['week', '周K'], ['month', '月K']]) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'detail-tab';
      tab.dataset.chartKey = key;
      tab.textContent = label;
      tabGroup.append(tab);
      this.tabEls.push(tab);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'detail-close-btn';
    close.dataset.action = 'detail-close';
    close.setAttribute('aria-label', '关闭详情面板');
    close.textContent = '✕';
    this.closeBtn = close;
    toolbar.append(title, tabGroup, close);

    const legend = document.createElement('div');
    legend.className = 'detail-legend';
    legend.setAttribute('aria-label', '图表图例');
    this.legendEl = legend;
    const wrap = document.createElement('div');
    wrap.className = 'detail-canvas-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'detail-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '行情图表，左右方向键查看逐点数据，Esc 关闭');
    canvas.tabIndex = 0;
    wrap.append(canvas);
    this.canvasEl = canvas;
    const status = document.createElement('div');
    status.className = 'detail-status';
    status.dataset.region = 'detail-status';
    status.setAttribute('role', 'status');
    status.hidden = true;
    this.statusEl = status;
    const metrics = document.createElement('div');
    metrics.className = 'detail-metrics';
    metrics.dataset.region = 'detail-metrics';
    metrics.setAttribute('aria-label', '当前图表读数');
    this.metricsEl = metrics;
    this.append(toolbar, legend, wrap, status, metrics);
    this.syncTabs();
  }

  private bindEvents(signal: AbortSignal): void {
    const close = () => emitPopupEvent(this, 'detail-close-request', {});
    this.closeBtn?.addEventListener('click', close, { signal });
    this.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    }, { signal });
    for (const tab of this.tabEls) {
      tab.addEventListener('click', () => {
        const key = tab.dataset.chartKey;
        this._kind = key === 'trends' ? 'trends' : 'kline';
        this._period = this._kind === 'trends' ? 'day' : key as KlinePeriod;
        this.syncTabs();
        void this.loadChart();
      }, { signal });
    }
    this.statusEl?.addEventListener('click', (event) => {
      if ((event.target as Element).closest('[data-action="chart-retry"]') && !this._loading) void this.loadChart();
    }, { signal });
    this.canvasEl?.addEventListener('mousemove', (event) => {
      const index = this.indexAt(event.clientX);
      if (index < 0 || index === this.activeIndex) return;
      this.activeIndex = index;
      this.render();
    }, { signal });
    this.canvasEl?.addEventListener('mouseleave', () => {
      this.activeIndex = null;
      this.render();
    }, { signal });
    this.canvasEl?.addEventListener('keydown', (event) => {
      const count = this.pointCount();
      if (!count || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = this.activeIndex ?? count - 1;
      this.activeIndex = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
        : Math.max(0, Math.min(count - 1, current + (event.key === 'ArrowLeft' ? -1 : 1)));
      this.render();
    }, { signal });
    this.canvasEl?.addEventListener('blur', () => { this.activeIndex = null; this.render(); }, { signal });
  }

  private pointCount(): number { return this._geo?.points?.length ?? this._geo?.bars?.length ?? 0; }

  private indexAt(mouseX: number): number {
    const geo = this._geo;
    const rect = this.canvasEl?.getBoundingClientRect();
    const count = this.pointCount();
    if (!geo || !rect?.width || !count) return -1;
    const x = ((mouseX - rect.left) / rect.width) * this._vw;
    if (x < PAD_LEFT || x > this._vw - PAD_RIGHT) return -1;
    // 时间轴包含缺失分钟/午休压缩，K线中心有半根宽度：按真实绘制坐标取最近点。
    let nearest = 0;
    for (let i = 1; i < count; i++) if (Math.abs(geo.xAt(i) - x) < Math.abs(geo.xAt(nearest) - x)) nearest = i;
    return nearest;
  }

  private applyViewModel(vm: DetailPanelViewModel): void {
    if (!vm.open || !vm.code) {
      const restoreFocus = !this.hidden && this.contains(document.activeElement);
      this.hidden = true;
      this.requestVersion++;
      this._loading = false;
      this.setAttribute('aria-busy', 'false');
      if (restoreFocus && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
      return;
    }
    const opening = this.hidden;
    if (opening) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.hidden = false;
    if (opening) this.closeBtn?.focus({ preventScroll: true });
    if (this.titleEl) this.titleEl.textContent = `${vm.name} ${vm.code}`;
    if (this._code !== vm.code) {
      this._code = vm.code;
      this._data = null;
      this._kind = 'trends';
      this._period = 'day';
      this.syncTabs();
      void this.loadChart();
    } else if (!this._data && !this._loading && !this._error) {
      void this.loadChart();
    } else if (this._data) {
      this.render();
    }
  }

  private syncTabs(): void {
    const selected = this._kind === 'trends' ? 'trends' : this._period;
    for (const tab of this.tabEls) {
      const active = tab.dataset.chartKey === selected;
      tab.setAttribute('aria-pressed', String(active));
      tab.classList.toggle('is-active', active);
    }
  }

  private async loadChart(): Promise<void> {
    const vm = this._viewModel;
    if (!vm?.open || !vm.code || !this._loader) return;
    const version = ++this.requestVersion;
    this._loading = true;
    this._error = null;
    this._data = null;
    this.activeIndex = null;
    this.setAttribute('aria-busy', 'true');
    this.renderStatus('加载中…');
    this.render();
    try {
      const data = await this._loader(vm.code, this._kind, this._period);
      if (version !== this.requestVersion) return;
      this._data = data;
      this.renderStatus('');
    } catch {
      if (version !== this.requestVersion) return;
      this._error = '加载失败';
      this.renderStatus('加载失败，请重试', true);
    } finally {
      if (version === this.requestVersion) {
        this._loading = false;
        this.setAttribute('aria-busy', 'false');
        this.render();
      }
    }
  }

  private renderStatus(text: string, retry = false): void {
    if (!this.statusEl) return;
    this.statusEl.replaceChildren();
    this.statusEl.hidden = !text;
    if (!text) return;
    const message = document.createElement('span');
    message.textContent = text;
    this.statusEl.append(message);
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'detail-retry-btn';
      button.dataset.action = 'chart-retry';
      button.textContent = '重试';
      this.statusEl.append(button);
    }
  }

  private render(): void {
    const canvas = this.canvasEl;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this._vw = rect.width > 0 ? rect.width : VIEW_W;
    this._vh = rect.height > 0 ? rect.height : VIEW_H;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const targetW = Math.round(this._vw * dpr);
    const targetH = Math.round(this._vh * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this._vw, this._vh);
    const theme = window.getComputedStyle(this);
    this.textColor = theme.getPropertyValue('--text-2').trim() || TEXT;
    this.upColor = theme.getPropertyValue('--up').trim() || CHART_UP;
    this.downColor = theme.getPropertyValue('--down').trim() || CHART_DOWN;
    this.flatColor = theme.getPropertyValue('--text-3').trim() || CHART_FLAT;
    this.priceLabelColor = theme.getPropertyValue('--ink-app').trim() || '#11151c';
    this._geo = null;
    const data = this._data;
    if (data?.kind === 'trends' && isUsableTrends(data.trends)) this.renderTrends(ctx, data.trends, data.prevClose);
    else if (data?.kind === 'kline' && isUsableKlines(data.klines)) this.renderKlines(ctx, data.klines);
    else {
      ctx.fillStyle = this.textColor;
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      const message = this._loading ? '正在加载走势…' : this._error ? '走势加载失败' : '暂无可用走势数据';
      ctx.fillText(message, this._vw / 2, this._vh / 2);
      canvas.setAttribute('aria-label', `${this._viewModel?.name ?? ''}，${message}，Esc 关闭`);
    }
    this.renderReadout();
    if (this.activeIndex !== null) this.drawCrosshair(ctx);
  }

  private volumeH(): number { return Math.max(42, Math.min(80, Math.round(this._vh * 0.2))); }
  private plotHeight(): number { return Math.max(40, this._vh - this.volumeH() - VOLUME_GAP - PAD_TOP - PAD_BOTTOM); }
  private volumeTop(): number { return PAD_TOP + this.plotHeight() + VOLUME_GAP; }
  private plotWidth(): number { return Math.max(1, this._vw - PAD_LEFT - PAD_RIGHT); }

  private priceRange(values: readonly number[], base?: number): readonly [number, number] {
    const usable = values.filter((value) => Number.isFinite(value) && value > 0);
    const min = Math.min(...usable);
    const max = Math.max(...usable);
    if (base && Number.isFinite(base) && base > 0) {
      const extent = Math.max(Math.abs(max - base), Math.abs(min - base), base * 0.002, 0.01) * 1.08;
      return [base - extent, base + extent];
    }
    const pad = Math.max((max - min) * 0.08, max * 0.001, 0.01);
    return [min - pad, max + pad];
  }

  private renderTrends(ctx: CanvasRenderingContext2D, points: readonly TrendPoint[], previous?: number): void {
    const base = previous && Number.isFinite(previous) && previous > 0 ? previous : undefined;
    const [min, max] = this.priceRange(points.flatMap((p) => [p.price, p.low, p.high, p.avgPrice]), base);
    const w = this.plotWidth();
    const h = this.plotHeight();
    const xAt = (i: number) => PAD_LEFT + w * this.sessionMinute(points[i].time) / 240;
    const yAt = (value: number) => PAD_TOP + h * (max - value) / (max - min);
    this._geo = { kind: 'trends', points, bars: null, xAt, yAt };
    this.drawGrid(ctx, min, max, yAt, base);
    this.drawTimeAxis(ctx);
    const maxVolume = Math.max(...points.map((p) => p.volume), 0);
    this.drawVolumeAxis(ctx, maxVolume);
    if (base) {
      ctx.strokeStyle = this.textColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      this.line(ctx, PAD_LEFT, yAt(base), PAD_LEFT + w, yAt(base));
      ctx.setLineDash([]);
    }
    const last = points[points.length - 1];
    const color = this.colorFor(last.price, base ?? points[0].price);
    const floor = base ? yAt(base) : PAD_TOP + h;
    ctx.beginPath();
    points.forEach((point, i) => { if (!i) ctx.moveTo(xAt(i), yAt(point.price)); else ctx.lineTo(xAt(i), yAt(point.price)); });
    ctx.lineTo(xAt(points.length - 1), floor);
    ctx.lineTo(xAt(0), floor);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + h);
    gradient.addColorStop(0, hexToRgba(color, 0.2));
    gradient.addColorStop(1, hexToRgba(color, 0.02));
    ctx.fillStyle = gradient;
    ctx.fill();
    this.drawSeries(ctx, points.map((p) => p.price), xAt, yAt, color, 1.7);
    this.drawSeries(ctx, points.map((p) => p.avgPrice > 0 ? p.avgPrice : null), xAt, yAt, MA_COLORS[0], 1.2);
    points.forEach((point, i) => this.drawVolumeBar(ctx, xAt(i), point.volume, maxVolume, Math.max(1, Math.min(3, w / 240 * 0.8)), this.colorFor(point.price, base ?? point.avgPrice)));
    this.drawLatestPrice(ctx, last.price, yAt(last.price), color);
  }

  private renderKlines(ctx: CanvasRenderingContext2D, history: readonly KlineBar[]): void {
    const start = Math.max(0, history.length - 60);
    const bars = history.slice(start);
    const averages = MA_PERIODS.map((period) => bars.map((_, i) => this.movingAverage(history, start + i, period)));
    const [min, max] = this.priceRange([...bars.flatMap((bar) => [bar.low, bar.high, bar.open, bar.close]), ...averages.flatMap((series) => series.filter((v): v is number => v !== null))]);
    const step = this.plotWidth() / bars.length;
    const bodyWidth = Math.min(18, Math.max(1, step * 0.65));
    const xAt = (i: number) => PAD_LEFT + step * (i + 0.5);
    const yAt = (value: number) => PAD_TOP + this.plotHeight() * (max - value) / (max - min);
    this._geo = { kind: 'kline', points: null, bars, xAt, yAt };
    this.drawGrid(ctx, min, max, yAt);
    this.drawDateAxis(ctx, bars, xAt);
    const maxVolume = Math.max(...bars.map((bar) => bar.volume), 0);
    this.drawVolumeAxis(ctx, maxVolume);
    bars.forEach((bar, i) => {
      const x = xAt(i);
      const color = this.colorFor(bar.close, bar.open);
      const top = yAt(Math.max(bar.open, bar.close));
      const height = Math.max(1, yAt(Math.min(bar.open, bar.close)) - top);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      this.line(ctx, x, yAt(bar.high), x, yAt(bar.low));
      if (bar.close >= bar.open) ctx.strokeRect(x - bodyWidth / 2, top, bodyWidth, height);
      else { ctx.fillStyle = color; ctx.fillRect(x - bodyWidth / 2, top, bodyWidth, height); }
      this.drawVolumeBar(ctx, x, bar.volume, maxVolume, bodyWidth, color);
    });
    averages.forEach((series, i) => this.drawSeries(ctx, series, xAt, yAt, MA_COLORS[i], 1));
    const last = bars[bars.length - 1];
    this.drawLatestPrice(ctx, last.close, yAt(last.close), this.colorFor(last.close, last.open));
  }

  private movingAverage(bars: readonly KlineBar[], index: number, period: number): number | null {
    if (index + 1 < period) return null;
    return bars.slice(index - period + 1, index + 1).reduce((sum, bar) => sum + bar.close, 0) / period;
  }

  private drawSeries(ctx: CanvasRenderingContext2D, values: readonly (number | null)[], xAt: (i: number) => number, yAt: (v: number) => number, color: string, width: number): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    let started = false;
    values.forEach((value, i) => {
      if (value === null || !Number.isFinite(value)) { started = false; return; }
      if (started) ctx.lineTo(xAt(i), yAt(value));
      else { ctx.moveTo(xAt(i), yAt(value)); started = true; }
    });
    ctx.stroke();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, min: number, max: number, yAt: (v: number) => number, base?: number): void {
    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';
    for (let row = 0; row <= 4; row++) {
      const value = max - (max - min) * row / 4;
      const y = yAt(value);
      ctx.strokeStyle = GRID;
      this.line(ctx, PAD_LEFT, y, this._vw - PAD_RIGHT, y);
      ctx.fillStyle = this.textColor;
      ctx.textAlign = 'right';
      ctx.fillText(value.toFixed(2), PAD_LEFT - 4, y + 3);
      if (base) {
        ctx.fillStyle = this.colorFor(value, base);
        ctx.textAlign = 'left';
        ctx.fillText(this.percent((value / base - 1) * 100), this._vw - PAD_RIGHT + 4, y + 3);
      }
    }
  }

  private drawTimeAxis(ctx: CanvasRenderingContext2D): void {
    ctx.font = '10px sans-serif';
    ctx.fillStyle = this.textColor;
    const marks = [['09:30', 0], ['11:30/13:00', 0.5], ['15:00', 1]] as const;
    for (const [label, ratio] of marks) {
      const x = PAD_LEFT + this.plotWidth() * ratio;
      ctx.textAlign = 'center';
      ctx.fillText(label, x, this._vh - 5);
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      this.line(ctx, x, PAD_TOP, x, PAD_TOP + this.plotHeight());
    }
  }

  private drawDateAxis(ctx: CanvasRenderingContext2D, bars: readonly KlineBar[], xAt: (i: number) => number): void {
    ctx.font = '10px sans-serif';
    ctx.fillStyle = this.textColor;
    ctx.textAlign = 'center';
    const crossesYear = bars[0].date.slice(0, 4) !== bars[bars.length - 1].date.slice(0, 4);
    const marks = [...new Set([0, Math.floor((bars.length - 1) / 2), bars.length - 1])];
    for (const index of marks) {
      const date = bars[index].date;
      ctx.fillText(crossesYear || this._period === 'month' ? date.slice(0, 7) : date.slice(5), xAt(index), this._vh - 5);
    }
  }

  private drawVolumeAxis(ctx: CanvasRenderingContext2D, max: number): void {
    const y = this.volumeTop();
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    this.line(ctx, PAD_LEFT, y, this._vw - PAD_RIGHT, y);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = this.textColor;
    ctx.textAlign = 'left';
    ctx.fillText(`成交量 ${this.formatVolume(max)}`, PAD_LEFT, y - 6);
    ctx.textAlign = 'right';
    ctx.fillText('0', PAD_LEFT - 4, y + this.volumeH() - 2);
  }

  private drawVolumeBar(ctx: CanvasRenderingContext2D, x: number, volume: number, max: number, width: number, color: string): void {
    if (!(volume > 0) || !(max > 0)) return;
    const height = volume / max * (this.volumeH() - 4);
    ctx.fillStyle = hexToRgba(color, 0.58);
    ctx.fillRect(x - width / 2, this.volumeTop() + this.volumeH() - height, width, height);
  }

  private drawLatestPrice(ctx: CanvasRenderingContext2D, price: number, y: number, color: string): void {
    ctx.strokeStyle = hexToRgba(color, 0.5);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    this.line(ctx, PAD_LEFT, y, this._vw - PAD_RIGHT, y);
    ctx.setLineDash([]);
    // 最新价放在左侧价格轴，右侧涨跌幅轴保留完整刻度。
    ctx.fillStyle = color;
    ctx.fillRect(0, y - 8, PAD_LEFT - 1, 16);
    ctx.fillStyle = this.priceLabelColor;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(price.toFixed(2), (PAD_LEFT - 1) / 2, y + 3);
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D): void {
    const geo = this._geo;
    if (!geo || this.activeIndex === null) return;
    const index = this.activeIndex;
    const price = geo.points?.[index]?.price ?? geo.bars?.[index]?.close;
    if (price === undefined) return;
    const x = geo.xAt(index);
    const y = geo.yAt(price);
    ctx.strokeStyle = this.textColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    this.line(ctx, x, PAD_TOP, x, this._vh - PAD_BOTTOM);
    this.line(ctx, PAD_LEFT, y, this._vw - PAD_RIGHT, y);
    ctx.setLineDash([]);
    ctx.fillStyle = this.textColor;
    ctx.fillRect(x - 2, y - 2, 4, 4);
  }

  private renderReadout(): void {
    if (!this.metricsEl || !this.legendEl) return;
    this.metricsEl.replaceChildren();
    this.legendEl.replaceChildren();
    const geo = this._geo;
    if (!geo) return;
    const index = this.activeIndex ?? this.pointCount() - 1;
    let heading = '';
    let values: readonly (readonly [string, string])[];
    if (geo.points) {
      const point = geo.points[index];
      const base = this._data?.prevClose;
      heading = `${this.chinaDate(point.time)} ${this.timeLabel(point.time)}${this.activeIndex === null ? ' · 最新' : ''}`;
      values = [['价格', point.price.toFixed(2)], ['涨跌幅', base && base > 0 ? this.percent((point.price / base - 1) * 100) : '—'], ['均价', point.avgPrice > 0 ? point.avgPrice.toFixed(2) : '—'], ['成交量', this.formatVolume(point.volume)], ['成交额', this.formatAmount(point.amount)]];
      this.legendItem('价格', this.colorFor(point.price, base ?? geo.points[0].price));
      this.legendItem('均价', MA_COLORS[0]);
      if (base && base > 0) this.legendItem(`昨收 ${base.toFixed(2)}`, this.textColor);
    } else {
      const bar = geo.bars![index];
      heading = `${bar.date}${this.activeIndex === null ? ' · 最新' : ''}`;
      values = [['开盘', bar.open.toFixed(2)], ['收盘', bar.close.toFixed(2)], ['涨跌幅', this.percent(bar.changePercent)], ['最高', bar.high.toFixed(2)], ['最低', bar.low.toFixed(2)], ['成交量', this.formatVolume(bar.volume)]];
      const history = this._data!.klines!;
      const sourceIndex = Math.max(0, history.length - 60) + index;
      MA_PERIODS.forEach((period, i) => {
        const average = this.movingAverage(history, sourceIndex, period);
        this.legendItem(`MA${period} ${average === null ? '—' : average.toFixed(2)}`, MA_COLORS[i]);
      });
    }
    const title = document.createElement('div');
    title.className = 'detail-readout-time';
    title.textContent = heading;
    this.metricsEl.append(title);
    for (const [label, value] of values) {
      const item = document.createElement('div');
      item.className = 'detail-metric-item';
      const name = document.createElement('span');
      name.textContent = label;
      const number = document.createElement('span');
      number.className = 'detail-metric-value';
      number.textContent = value;
      item.append(name, number);
      this.metricsEl.append(item);
    }
    this.canvasEl?.setAttribute('aria-label', `${this._viewModel?.name ?? ''}，${heading}，${values.map(([label, value]) => label + value).join('，')}。左右方向键查看，Esc 关闭`);
  }

  private legendItem(text: string, color: string): void {
    const item = document.createElement('span');
    item.className = 'detail-legend-item';
    item.style.setProperty('--legend-color', color);
    item.textContent = text;
    this.legendEl?.append(item);
  }

  private line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  /** A 股交易时段：9:30–11:30 / 13:00–15:00；与电脑所在时区无关。 */
  private sessionMinute(time: number): number {
    const date = new Date(time + CHINA_OFFSET);
    const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
    return Math.max(0, Math.min(240, minute <= 690 ? minute - 570 : Math.max(120, minute - 780 + 120)));
  }

  private timeLabel(time: number): string { return new Date(time + CHINA_OFFSET).toISOString().slice(11, 16); }
  private chinaDate(time: number): string { return new Date(time + CHINA_OFFSET).toISOString().slice(0, 10); }
  private percent(value: number): string { return `${value > 0 ? '+' : ''}${Math.abs(value) < 0.005 ? '0.00' : value.toFixed(2)}%`; }
  private formatVolume(value: number): string {
    return value >= 100_000_000 ? `${(value / 100_000_000).toFixed(2)}亿手` : value >= 10_000 ? `${(value / 10_000).toFixed(2)}万手` : `${Math.round(value)}手`;
  }
  private formatAmount(value: number): string {
    return value >= 100_000_000 ? `${(value / 100_000_000).toFixed(2)}亿元` : value >= 10_000 ? `${(value / 10_000).toFixed(2)}万元` : `${value.toFixed(0)}元`;
  }
  private colorFor(value: number, base: number): string { return value > base ? this.upColor : value < base ? this.downColor : this.flatColor; }
}
