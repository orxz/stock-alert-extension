// src/infrastructure/chrome/chrome-alarm-adapter.ts
// ChromeAlarmAdapter：AlarmPort 的 Chrome 实现。
// 包装 chrome.alarms：get → chrome.alarms.get、schedule → chrome.alarms.create。
// 调度策略（safety-before-work / exact-after-work）保留在 Background scheduler 中。
import type { AlarmPort, AlarmDescriptor } from '../../application/ports/alarm.js';

/**
 * Chrome alarms 适配器：实现 AlarmPort。
 *
 * - get(name): chrome.alarms.get 返回 chrome.alarms.Alarm（name + scheduledTime）；
 *   不存在返回 null。
 * - schedule(name, when): chrome.alarms.create with delayInMinutes = (when - Date.now()) / 60000。
 *   将传入的绝对时间戳 when（Unix ms）转为相对分钟数（与 v1.3 scheduleNextAlarm 一致）；
 *   Chrome MV3 内部将 < 0.5 分钟的延迟 clamp 到 0.5 分钟（30 秒，即盘中 exact interval）。
 */
export class ChromeAlarmAdapter implements AlarmPort {
  async get(name: string): Promise<AlarmDescriptor | null> {
    const alarms = await chrome.alarms.get(name);
    if (!alarms) return null;
    return { name: alarms.name, scheduledTime: alarms.scheduledTime };
  }

  async schedule(name: string, when: number): Promise<void> {
    const delayInMinutes = (when - Date.now()) / 60_000;
    await chrome.alarms.create(name, { delayInMinutes });
  }
}

/** 创建 ChromeAlarmAdapter 实例的工厂函数。 */
export function createChromeAlarmAdapter(): AlarmPort {
  return new ChromeAlarmAdapter();
}
