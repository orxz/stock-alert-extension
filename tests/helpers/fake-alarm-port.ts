// tests/helpers/fake-alarm-port.ts
// 内存 AlarmPort：测试专用。记录 schedule 调用，支持 calls.kind 断言与 current 操作。
//
// calls 的 kind 标注规则（与 scheduler 契约一致）：
// scheduler.runQuoteCycle 每次执行恰好产生 2 次 schedule（safety-before-work + exact-after-work），
// 因此按调用序号配对：偶数序号（0,2,4...）→ 'safety'，奇数序号（1,3,5...）→ 'exact'。
// ensureAlarm 单独调用时只产生 1 次 schedule（safety alarm），序号 0 → 'safety'。
import type { AlarmPort, AlarmDescriptor } from '../../src/application/ports/alarm.js';

/** 单次 schedule 调用记录（含推断的 kind）。 */
export interface ScheduleCall {
  readonly name: string;
  readonly when: number;
  readonly kind: 'safety' | 'exact';
}

/**
 * 内存 AlarmPort：确定性、无 IO 延迟。
 * - current: 可直接赋值（测试模拟 alarm 存在/缺失）。
 * - get(name): 返回 current（若 name 匹配），否则 null。
 * - schedule(name, when): 记录到 _raw + 更新 current。
 * - calls: 只读视图，按序号配对标注 kind。
 */
export class FakeAlarmPort implements AlarmPort {
  current: AlarmDescriptor | null = null;
  private readonly _raw: { name: string; when: number }[] = [];

  async get(name: string): Promise<AlarmDescriptor | null> {
    if (this.current !== null && this.current.name === name) {
      return this.current;
    }
    return null;
  }

  async schedule(name: string, when: number): Promise<void> {
    this._raw.push({ name, when });
    this.current = { name, scheduledTime: when };
  }

  /** schedule 调用记录（按序号配对标注 kind：偶数→safety，奇数→exact）。 */
  get calls(): readonly ScheduleCall[] {
    return this._raw.map((call, index) => ({
      name: call.name,
      when: call.when,
      kind: (index % 2 === 0 ? 'safety' : 'exact') as 'safety' | 'exact'
    }));
  }

  /** 测试辅助：清空调用记录与 current。 */
  reset(): void {
    this._raw.length = 0;
    this.current = null;
  }
}
