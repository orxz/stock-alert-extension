// src/popup/components/index-strip.ts
// 固定大盘指数条（v2.1+/v2.2）：popup 顶部常驻「上证指数 / 深证成指 / 创业板指 / 科创50」。
// 纯展示 Light DOM 组件——只接收 IndexStripViewModel，不发出事件、不访问 Store/RPC。
// 目录与顺序的真相在 domain/index-quote.ts；数据来自 QuoteService 合并的行情快照。
// v2.2 迷你图：AppShell 注入 sparklineLoader（分时数据源），组件自拉目录分时并绘制
// 迷你趋势（20 点抽样）；加载失败静默降级为无迷你图——指数条核心信息不受影响。
// a11y：role=list/listitem + 每只指数的 aria-label 携带完整读值（名称+点位+涨跌幅）。
import type { IndexStripItemViewModel, IndexStripViewModel } from '../view-models.js';
import { emptyIndexStrip } from '../view-models.js';
import { buildIndexSparkline } from '../../domain/index.js';
import type { TrendPoint } from '../../domain/index.js';
import { drawSparkline, CHART_UP, CHART_DOWN, CHART_FLAT } from './sparkline.js';
import { emitPopupEvent } from './events.js';

/** 迷你图加载器（返回分时点；失败抛错，由组件静默降级）。 */
export type SparklineLoader = (code: string) => Promise<readonly TrendPoint[]>;

export class IndexStripElement extends HTMLElement {
  private skeletonBuilt = false;
  private _viewModel: IndexStripViewModel | null = null;
  private _loader: SparklineLoader | null = null;
  /** 迷你图数据缓存：code → 归一化纵坐标序列。 */
  private readonly sparklines = new Map<string, readonly number[]>();

  connectedCallback(): void {
    if (!this.skeletonBuilt) {
      this.className = 'index-strip';
      this.setAttribute('data-region', 'index-strip');
      this.setAttribute('role', 'group');
      this.setAttribute('aria-label', '大盘指数');
      this.skeletonBuilt = true;
    }
    // 事件委托：点击/键盘激活指数 chip → 打开详情面板（分时/K线）。
    this.addEventListener('click', (e) => this.activateChip(e.target as HTMLElement));
    this.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this.activateChip(e.target as HTMLElement);
    });
    if (this._viewModel) this.applyViewModel(this._viewModel);
  }

  /** 从事件目标找到 chip 并发出 detail-open-request。 */
  private activateChip(target: HTMLElement): void {
    const chip = target.closest('.index-chip') as HTMLElement | null;
    if (!chip) return;
    const code = chip.dataset.code;
    const name = chip.querySelector('.index-chip-name')?.textContent ?? '';
    if (code) emitPopupEvent(this, 'detail-open-request', { code: code as never, name });
  }

  get viewModel(): IndexStripViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: IndexStripViewModel | null | undefined) {
    // 防御：上游漏传时退回空目录骨架（'--' 占位），不让渲染链路整个崩掉。
    this._viewModel = value ?? emptyIndexStrip();
    if (this.isConnected) this.applyViewModel(this._viewModel);
  }

  /** 注入迷你图数据源（AppShell 每次创建时调用；换标时自动重拉）。 */
  setSparklineLoader(loader: SparklineLoader | null): void {
    this._loader = loader;
    this.sparklines.clear();
    if (this._viewModel) this.warmSparklines();
  }

  /** 预热：为目录各指数拉取分时（互不阻塞；失败静默跳过）。 */
  private warmSparklines(): void {
    if (!this._loader) return;
    for (const item of this._viewModel?.items ?? []) {
      if (this.sparklines.has(String(item.code))) continue;
      this._loader(String(item.code))
        .then((points) => {
          this.sparklines.set(String(item.code), buildIndexSparkline(points));
          this.applyViewModel(this._viewModel ?? emptyIndexStrip());
        })
        .catch(() => {
          /* 静默降级：无迷你图，核心点位/涨跌幅照常 */
        });
    }
  }

  private applyViewModel(vm: IndexStripViewModel): void {
    // 条目数量恒等于目录全集；仅按 code 更新文本与趋势类，避免整条重建打断读屏。
    const existing = new Map<string, HTMLElement>();
    for (const child of Array.from(this.children)) {
      const code = (child as HTMLElement).dataset.code;
      if (code) existing.set(code, child as HTMLElement);
    }

    for (const item of vm.items) {
      let chip = existing.get(String(item.code));
      if (!chip) {
        chip = document.createElement('div');
        chip.className = 'index-chip';
        chip.setAttribute('role', 'button');
        chip.dataset.code = String(item.code);
        chip.innerHTML =
          '<span class="index-chip-name"></span><span class="index-chip-price"></span><span class="index-chip-pct"></span><canvas class="index-chip-spark" width="36" height="18"></canvas>';
        this.append(chip);
      }
      existing.delete(String(item.code));
      this.applyItem(chip, item);
    }

    // 目录收缩时的防御性清理（当前目录恒定，实际不可达）。
    for (const stale of existing.values()) stale.remove();

    // 迷你图数据就绪后绘制（幂等：已画过的不重复画）。
    if (this._loader && this.sparklines.size > 0) this.drawSparklines(vm);
  }

  private applyItem(chip: HTMLElement, item: IndexStripItemViewModel): void {
    const nameEl = chip.querySelector('.index-chip-name');
    const priceEl = chip.querySelector('.index-chip-price');
    const pctEl = chip.querySelector('.index-chip-pct');
    if (nameEl) nameEl.textContent = item.name;
    if (priceEl) priceEl.textContent = item.displayPrice;
    if (pctEl) {
      pctEl.textContent =
        item.staleLabel && item.displayChangePercent !== '--'
          ? `${item.displayChangePercent}·${item.staleLabel}`
          : item.displayChangePercent;
    }
    chip.classList.toggle('is-up', item.trend === 'up');
    chip.classList.toggle('is-down', item.trend === 'down');
    chip.classList.toggle('is-flat', item.trend === 'flat' || item.trend === 'none');
    // v2.3 点击指数进详情面板（分时/K线同自选股）。
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.dataset.code = String(item.code);
    chip.setAttribute(
      'aria-label',
      `${item.name} ${item.displayPrice} ${item.displayChangePercent}${item.staleLabel ? ` ${item.staleLabel}` : ''}，点击查看分时与K线`
    );
  }

  /** 绘制全部就绪的迷你图（canvas 自绘；涨跌色与指数条趋势一致）。 */
  private drawSparklines(vm: IndexStripViewModel): void {
    for (const item of vm.items) {
      const chip = this.querySelector(`.index-chip[data-code="${item.code}"]`) as HTMLElement | null;
      const canvas = chip?.querySelector('.index-chip-spark') as HTMLCanvasElement | null;
      if (!canvas) continue;
      const seq = this.sparklines.get(String(item.code));
      if (!seq || seq.length < 2) {
        // 数据未就绪：清空（保持透明）。
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        continue;
      }
      // 委托公共绘制（单一真相）：颜色跟随快照 trend（与点位/涨跌幅一致，
      // 而非序列首尾——快照趋势更权威），渐变稍浓（小尺寸可读性）。
      drawSparkline(canvas, seq, {
        color:
          item.trend === 'up' ? CHART_UP
          : item.trend === 'down' ? CHART_DOWN
          : CHART_FLAT,
        fillTop: 0.25,
        fillBottom: 0.04,
        lineWidth: 1.3
      });
    }
  }
}

