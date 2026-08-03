// src/application/ports/clock.ts
// 时钟端口接口：Application 服务通过此接口获取时间戳和调度回调。
// 纯接口——不依赖 Date.now() / setTimeout / Chrome 定时器。
// 共享 domain 代码绝不调用此接口（时间通过参数传入 domain 纯函数）。
// 测试使用 FixedClock（tests/helpers/fixed-clock.ts）；生产使用 SystemClock（infrastructure 层）。

/**
 * 可取消的定时器句柄：schedule 返回，cancel 取消待执行回调。
 */
export interface Cancelable {
  cancel(): void;
}

/**
 * 时钟端口：Application 层获取当前时间戳与调度延迟回调的唯一入口。
 * - now(): 返回当前 Unix 毫秒时间戳（用于 addedAt / updatedAt / deadline）。
 * - schedule(): 在 delayMs 后执行 callback；返回句柄可取消。
 */
export interface Clock {
  now(): number;
  schedule(delayMs: number, callback: () => void): Cancelable;
}
