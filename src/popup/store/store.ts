// src/popup/store/store.ts
// createStore：Popup 单向数据流的最小可观察 Store。
// - dispatch 调 reducer 更新 state，再通知 listener。
// - subscribe 返回 unsubscribe 函数；listener 集合在通知前快照（防迭代中增删）。
// - unsubscribe 幂等（Set.delete 对不存在元素无副作用）。
import type { AppAction } from './actions.js';
import type { AppState } from './state.js';
import { reducer as defaultReducer } from './reducer.js';

/** Reducer 函数签名。 */
export type Reducer = (state: AppState, action: AppAction) => AppState;

/** Store 接口（brief Step 4 逐字）。 */
export interface Store {
  getState(): AppState;
  dispatch(action: AppAction): void;
  subscribe(listener: () => void): () => void;
}

/**
 * 创建一个可观察的 Store。
 * @param reducerOrNull 状态归约函数；缺省使用本模块的纯 reducer。
 * @param initialState 初始不可变状态。
 */
export function createStore(reducerOrNull: Reducer, initialState: AppState): Store {
  const reduce = reducerOrNull;
  let state = initialState;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch: (action: AppAction): void => {
      state = reduce(state, action);
      // 通知前快照：迭代过程中新增/移除的 listener 不影响本轮通知。
      const snapshot = [...listeners];
      for (const listener of snapshot) {
        listener();
      }
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      // 幂等：重复调用安全（Set.delete 删除不存在的元素不报错）。
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

export { defaultReducer as reducer };
