// tests/helpers/fixed-clock.ts
// 确定性时钟：测试专用。now() 返回固定值，schedule() 记录调用（不实际延迟）。
// advance() 可手动推进时间，用于测试时间相关的 age/freshness 逻辑。
import type { Clock, Cancelable } from '../../src/application/ports/clock.js';

/** 已调度的回调记录（测试可断言）。 */
export interface ScheduledCall {
  readonly delayMs: number;
  readonly callback: () => void;
  readonly cancelled: boolean;
}

/**
 * 固定时钟：now() 始终返回同一值（除非 advance/setTime）。
 * schedule() 不执行回调，只记录到 scheduled 数组供测试断言。
 * cancel() 标记对应记录为已取消。
 */
export class FixedClock implements Clock {
  private currentTime: number;
  readonly scheduled: ScheduledCall[] = [];

  constructor(initialTime: number) {
    this.currentTime = initialTime;
  }

  now(): number {
    return this.currentTime;
  }

  schedule(delayMs: number, callback: () => void): Cancelable {
    const entry: ScheduledCall = { delayMs, callback, cancelled: false };
    this.scheduled.push(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
      }
    };
  }

  /** 推进时间（毫秒）。 */
  advance(deltaMs: number): void {
    this.currentTime += deltaMs;
  }

  /** 直接设置时间。 */
  setTime(timeMs: number): void {
    this.currentTime = timeMs;
  }

  /** 执行所有未取消的已调度回调（按记录顺序）。 */
  flush(): void {
    for (const entry of this.scheduled) {
      if (!entry.cancelled) entry.callback();
    }
  }
}
