// src/background/initialization-barrier.ts
// 三态可重试初始化屏障：idle → running → ready。
// 纯 ES2022，零依赖——可被 main.ts（生产）与 router.test.ts（测试）共享。
//
// 设计要点（brief Step 3 逐字）：
// - ready 态缓存值，后续 get() 同步返回 Promise.resolve(value)。
// - running 态返回进行中的 Promise——并发首事件共享同一次 attempt。
// - 失败时 running→idle（不缓存错误），下一次 get() 重新触发 initialize()。
export interface InitializationBarrier<T> {
  get(): Promise<T>;
}

/**
 * 创建初始化屏障。
 *
 * @param initialize 惰性初始化工厂（创建 Coordinator + Repositories + Services）。
 *   仅在首次 get() 或上次失败后的下一次 get() 时调用一次。
 * @returns { get() } —— ready 后同步返回缓存值；running 时共享 attempt；失败回 idle。
 */
export function createInitializationBarrier<T>(
  initialize: () => Promise<T>
): InitializationBarrier<T> {
  let state: 'idle' | 'running' | 'ready' = 'idle';
  let value: T | undefined;
  let running: Promise<T> | undefined;
  return {
    get(): Promise<T> {
      if (state === 'ready') return Promise.resolve(value as T);
      if (state === 'running') return running as Promise<T>;
      state = 'running';
      running = initialize().then(
        (next) => {
          value = next;
          state = 'ready';
          return next;
        },
        (error) => {
          running = undefined;
          state = 'idle';
          throw error;
        }
      );
      return running;
    }
  };
}
