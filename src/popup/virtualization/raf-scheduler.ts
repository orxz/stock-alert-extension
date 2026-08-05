// src/popup/virtualization/raf-scheduler.ts
// 帧合并调度器：把一帧内的多次 schedule() 压成一次 task()。
// 滚动事件的触发频率高于渲染帧率，逐事件重算虚拟窗口纯属浪费。
// requestAnimationFrame / cancelAnimationFrame 由调用方注入，便于确定性测试。

/** 帧调度句柄。 */
export interface RafScheduler {
  /** 请求在下一帧执行 task；同帧内重复调用只排一次。 */
  schedule(): void;
  /** 取消尚未执行的帧任务（组件断开时必须调用，避免泄漏）。 */
  cancel(): void;
}

/**
 * 创建帧合并调度器。
 *
 * @param requestFrame 通常是 `requestAnimationFrame`
 * @param cancelFrame  通常是 `cancelAnimationFrame`
 * @param task         每帧最多执行一次的任务
 */
export function createRafScheduler(
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void,
  task: () => void
): RafScheduler {
  let handle: number | null = null;

  return {
    schedule(): void {
      if (handle !== null) return;
      handle = requestFrame(() => {
        // 先清句柄再执行：task 抛错时若句柄仍挂着，调度器会永久卡死，
        // 后续滚动再也不会触发更新。
        handle = null;
        task();
      });
    },
    cancel(): void {
      if (handle === null) return;
      cancelFrame(handle);
      handle = null;
    }
  };
}
