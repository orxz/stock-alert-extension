// src/domain/chart.ts
// 图表领域模型与纯规则（v2.2 分时/K线）。
//
// 三个值对象 + 一个纯校验函数：
// - TrendPoint：分时一分钟点（f51-f58 实证映射，见 docs/调研-大盘指数支持.md 同源的字段纪律）。
// - KlineBar：K线一根（日/周/月，klt=101/102/103）。
// - ChartKind / KlinePeriod：图表形态与周期枚举（协议层复用）。
// - mergeTrends / buildIndexSparkline：指数条迷你图投影用的纯函数。
//
// 字段绑定纪律（f51/f52 教训延续）：trends2 的字段语义必须拿真实响应核对——
// 实测样本见仓库诊断记录：f51=时间 f52=价格 f53=均价 f54=分钟内高 f55=分钟内低
// f56=成交量(手) f57=成交额(元) f58=量比权重。K线 kline 响应 K 数组：
// 日期,开,收,高,低,量,额,振幅,涨跌幅,涨跌额,换手率（f51-f61）。
export type StockCode = string;

/** 分时一分钟点。 */
export interface TrendPoint {
  /** 分钟时间戳（毫秒，本地时区无关的 UTC 毫秒——时间轴直接用数值比较）。 */
  readonly time: number;
  /** 分钟价格（f52）。 */
  readonly price: number;
  /** 当日均价（f53）。 */
  readonly avgPrice: number;
  /** 分钟内最高（f54）。 */
  readonly high: number;
  /** 分钟内最低（f55）。 */
  readonly low: number;
  /** 分钟成交量（手，f56）。 */
  readonly volume: number;
  /** 分钟成交额（元，f57）。 */
  readonly amount: number;
  /** 量比权重（f58）。 */
  readonly volumeRatio: number;
}

/** K线一根。 */
export interface KlineBar {
  /** 日期（ISO yyyy-mm-dd，周/月K 取周期首日）。 */
  readonly date: string;
  /** 开（f52）。 */
  readonly open: number;
  /** 收（f53）。 */
  readonly close: number;
  /** 高（f54）。 */
  readonly high: number;
  /** 低（f55）。 */
  readonly low: number;
  /** 成交量（手，f56）。 */
  readonly volume: number;
  /** 成交额（元，f57）。 */
  readonly amount: number;
  /** 涨跌幅（%，f59）。 */
  readonly changePercent: number;
  /** 换手率（%，f61）。 */
  readonly turnoverRate: number;
}

/** 图表形态。 */
export type ChartKind = 'trends' | 'kline';

/** K线周期（东财 klt：101 日 / 102 周 / 103 月）。 */
export type KlinePeriod = 'day' | 'week' | 'month';

/** 一次图表加载的结果（trends 或 kline 之一）。 */
export interface ChartData {
  readonly code: StockCode;
  readonly kind: ChartKind;
  /** 名称（远端返回；trends 有 name，kline 也可带 name 字段）。 */
  readonly name: string;
  /** 昨收（涨跌基准线；trends 必带，kline 缺省 undefined）。 */
  readonly prevClose?: number;
  /** 分时点（kind==='trends' 时非空）。 */
  readonly trends?: readonly TrendPoint[];
  /** K线（kind==='kline' 时非空）。 */
  readonly klines?: readonly KlineBar[];
  /** 抓取时刻（毫秒）。 */
  readonly fetchedAt: number;
}

/** 图表加载失败。 */
export interface ChartError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/**
 * 从分时点投影指数条迷你图（抽样：固定 20 点以内，避免 121 点全塞进 28px 条）。
 * 返回归一化 0..1 的纵坐标序列（按最小/最大价），无变化时为 [0.5]。
 */
export function buildIndexSparkline(
  trends: readonly TrendPoint[],
  maxPoints = 20
): readonly number[] {
  if (trends.length === 0) return [0.5];
  const step = Math.max(1, Math.ceil(trends.length / maxPoints));
  const sampled: number[] = [];
  for (let i = 0; i < trends.length; i += step) {
    sampled.push(trends[i].price);
  }
  const last = trends[trends.length - 1].price;
  if (sampled[sampled.length - 1] !== last) sampled.push(last);

  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  if (max === min) return sampled.map(() => 0.5);
  return sampled.map((v) => (v - min) / (max - min));
}

/**
 * 分时点是否可用：至少 2 点且价格全为正。
 * 停牌/盘前空数组或零价行情（绝不用于画图——不生成模拟曲线）。
 */
export function isUsableTrends(trends: readonly TrendPoint[] | undefined): trends is readonly TrendPoint[] {
  return !!trends && trends.length >= 2 && trends.every((t) => Number.isFinite(t.price) && t.price > 0);
}

/** K线可用判定：至少 1 根且价格有限正数。 */
export function isUsableKlines(klines: readonly KlineBar[] | undefined): klines is readonly KlineBar[] {
  return !!klines && klines.length >= 1 && klines.every((k) => Number.isFinite(k.close) && k.close > 0);
}
