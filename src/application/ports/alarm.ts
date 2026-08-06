// src/application/ports/alarm.ts
// Alarm 端口接口：Application 层通过此接口查询与调度 chrome.alarms 定时器。
// 纯接口——不依赖 infrastructure/Chrome。
// 具体实现（ChromeAlarmAdapter）在 infrastructure 层，包装 chrome.alarms。
//
// 调度策略（safety-before-work / exact-after-work）保留在 Background scheduler 中，
// 本端口仅提供原子操作：get 查询 / schedule 安排一次延迟触发。
//
// 设计要点（brief Step 3 逐字）：
// - get(name): 返回已存在的 alarm 描述符（name + scheduledTime），不存在返回 null。
// - schedule(name, when): 安排一次 alarm 在绝对时间戳 when（ms）触发；
//   Chrome 实现内部将 delta 分钟数转 delayInMinutes（最小 0.5 分钟）。

/**
 * 已注册的 alarm 描述符。
 */
export interface AlarmDescriptor {
  readonly name: string;
  readonly scheduledTime: number;
}

/**
 * Alarm 端口：查询与调度 chrome.alarms。
 * - get(name): 返回已注册 alarm 描述符，不存在返回 null。
 * - schedule(name, when): 在绝对时间戳 when（Unix ms）安排一次触发。
 *   Chrome 实现内部转 delayInMinutes = max((when - Date.now()) / 60000, 0.5)。
 */
export interface AlarmPort {
  get(name: string): Promise<AlarmDescriptor | null>;
  schedule(name: string, when: number): Promise<void>;
}
