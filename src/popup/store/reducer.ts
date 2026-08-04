// src/popup/store/reducer.ts
// 纯 Reducer：(state, action) => state。唯一状态写入口。
// 规则：
//   1. 只有 confirmed bootstrap / mutations 替换持久 Domain 数据。
//   2. 只克隆变更分支，未变更分支保持引用相等。
//   3. 未知 action 返回原 state（相同引用）。
//   4. stale generation 拒绝：quote/search 的 confirmed/failed 比对 action.generation 与 state 中的 generation。
import type { AppAction } from './actions.js';
import type { AppState, MutationAsyncState } from './state.js';

/** brief Step 1 逐字测试省略 key 时的默认槽位。 */
const DEFAULT_MUTATION_KEY = '__default__';

/**
 * 纯 Reducer。对未知 action 返回相同引用；对 stale generation 返回相同引用。
 * 其余分支按需浅克隆顶层 + 变更分支，保持未变更分支引用相等。
 */
export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    // ===== bootstrap =====
    case 'bootstrap/requested':
      return { ...state, async: { ...state.async, bootstrap: { status: 'loading' } } };

    case 'bootstrap/confirmed':
      return {
        ...state,
        domain: {
          userData: action.result.userData,
          revision: action.result.revision,
          quotes: action.result.quoteSnapshot
        },
        async: { ...state.async, bootstrap: { status: 'success' } }
      };

    case 'bootstrap/failed':
      return { ...state, async: { ...state.async, bootstrap: { status: 'error', error: action.error } } };

    // ===== quote refresh =====
    case 'quote/refresh/requested':
      return {
        ...state,
        async: {
          ...state.async,
          quoteRefresh: { status: 'loading' },
          quoteGeneration: state.async.quoteGeneration + 1
        }
      };

    case 'quote/refresh/confirmed': {
      if (action.generation !== state.async.quoteGeneration) return state; // stale
      return {
        ...state,
        domain: { ...state.domain, quotes: action.snapshot },
        async: { ...state.async, quoteRefresh: { status: 'success' } }
      };
    }

    case 'quote/refresh/failed': {
      if (action.generation !== state.async.quoteGeneration) return state; // stale
      return { ...state, async: { ...state.async, quoteRefresh: { status: 'error', error: action.error } } };
    }

    // ===== search =====
    case 'search/keyword':
      return { ...state, view: { ...state.view, searchKeyword: action.keyword } };

    case 'search/requested':
      return {
        ...state,
        view: { ...state.view, searchKeyword: action.query },
        async: {
          ...state.async,
          stockSearch: { status: 'loading' },
          searchGeneration: action.generation
        }
      };

    case 'search/confirmed': {
      if (action.generation !== state.async.searchGeneration) return state; // stale
      return {
        ...state,
        view: { ...state.view, searchResults: action.results },
        async: { ...state.async, stockSearch: { status: 'success' } }
      };
    }

    case 'search/failed': {
      if (action.generation !== state.async.searchGeneration) return state; // stale
      return { ...state, async: { ...state.async, stockSearch: { status: 'error', error: action.error } } };
    }

    // ===== mutation lifecycle =====
    case 'mutation/pending': {
      const key = action.key ?? DEFAULT_MUTATION_KEY;
      return {
        ...state,
        async: { ...state.async, mutations: { ...state.async.mutations, [key]: { status: 'pending' } } }
      };
    }

    case 'mutation/uncertain': {
      const key = action.key ?? DEFAULT_MUTATION_KEY;
      const prev = state.async.mutations[key];
      const next: MutationAsyncState = { status: 'uncertain', error: prev?.error };
      return {
        ...state,
        async: { ...state.async, mutations: { ...state.async.mutations, [key]: next } }
      };
    }

    case 'mutation/confirmed': {
      const key = action.key ?? DEFAULT_MUTATION_KEY;
      const { [key]: _removed, ...rest } = state.async.mutations;
      return {
        ...state,
        domain: {
          userData: action.result.userData,
          revision: action.result.revision,
          quotes: state.domain.quotes
        },
        async: { ...state.async, mutations: rest }
      };
    }

    case 'mutation/reconciled': {
      const key = action.key ?? DEFAULT_MUTATION_KEY;
      const { [key]: _removed, ...rest } = state.async.mutations;
      return { ...state, async: { ...state.async, mutations: rest } };
    }

    case 'mutation/failed': {
      const key = action.key ?? DEFAULT_MUTATION_KEY;
      return {
        ...state,
        async: {
          ...state.async,
          mutations: { ...state.async.mutations, [key]: { status: 'failed', error: action.error } }
        }
      };
    }

    // ===== view =====
    case 'view/currentGroup':
      return { ...state, view: { ...state.view, currentGroupId: action.groupId } };

    case 'view/searchKeyword':
      return { ...state, view: { ...state.view, searchKeyword: action.keyword } };

    case 'view/selection':
      return { ...state, view: { ...state.view, selectedCodes: action.codes } };

    case 'view/selectionMode':
      return { ...state, view: { ...state.view, selectionMode: action.enabled, selectedCodes: action.enabled ? state.view.selectedCodes : [] } };

    case 'view/clearSelection':
      return { ...state, view: { ...state.view, selectedCodes: [] } };

    case 'view/theme':
      return { ...state, view: { ...state.view, theme: action.theme } };

    // ===== overlay =====
    case 'overlay/dialog':
      return { ...state, overlay: { ...state.overlay, dialog: action.dialog } };

    case 'overlay/menu':
      return { ...state, overlay: { ...state.overlay, menu: action.menu } };

    case 'overlay/toast':
      return { ...state, overlay: { ...state.overlay, toast: action.toast } };

    case 'overlay/focusReturn':
      return { ...state, overlay: { ...state.overlay, focusReturnId: action.id } };

    default:
      // 未知 action：返回原 state（相同引用）。
      return state;
  }
}
