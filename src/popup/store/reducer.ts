// src/popup/store/reducer.ts
// 纯 Reducer：(state, action) => state。唯一状态写入口。
// 规则：
//   1. 只有 confirmed bootstrap / mutations 替换持久 Domain 数据。
//   2. 只克隆变更分支，未变更分支保持引用相等。
//   3. 未知 action 返回原 state（相同引用）。
//   4. stale generation 拒绝：quote/search 的 confirmed/failed 比对 action.generation 与 state 中的 generation。
import type { AppAction } from './actions.js';
import type { AppState, MutationAsyncState } from './state.js';
import { stocksForGroup } from '../../domain/index.js';
import type { GroupId, UserData } from '../../domain/index.js';

/** 固定计算视图分组 ID（恒存在，删除任何自定义分组后的默认回退目标）。 */
const ALL_GROUP_ID = 'g_all' as GroupId;

/**
 * userData 落地后校正 view 分组：当前组若已不存在（被删除 / uncertain 对账后消失）
 * → 回退「全部」并清空选中集。不变量：currentGroupId 始终指向存在的分组。
 * 组仍存在时原样返回（引用不变，保持分支克隆最小化）。
 */
function settleCurrentGroup(view: AppState['view'], userData: UserData): AppState['view'] {
  const exists = userData.groups.some((g) => g.groupId === view.currentGroupId);
  if (exists) return view;
  return { ...view, currentGroupId: ALL_GROUP_ID, selectedCodes: [] };
}

/**
 * userData 落地后校正 view：分组不变量 + 选中集不变量。
 * 不变量：选中集 ⊆ 当前分组可见集（g_all 语义由 domain 的 stocksForGroup 处理）。
 * 两条替换 userData 的路径（bootstrap/confirmed 与 mutation/confirmed）都必须过这里——
 * 对账路径（写命令超时 → uncertain → app:bootstrap 装权威快照）同样会让选中项消失，
 * 只在 mutation 分支收敛会让批量工具栏为已删除的股票留下计数。
 * 无变化时返回原引用，保持分支克隆最小化。
 */
function settleView(view: AppState['view'], userData: UserData): AppState['view'] {
  const settled = settleCurrentGroup(view, userData);
  const visible = new Set(stocksForGroup(userData.watchlist, settled.currentGroupId).map((s) => s.code));
  const selectedCodes = settled.selectedCodes.filter((code) => visible.has(code));
  return selectedCodes.length === settled.selectedCodes.length ? settled : { ...settled, selectedCodes };
}

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
        view: settleView(state.view, action.result.userData),
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
      // 当前分组可见集合可能已变化（moveStocks/removeStocks 等）：settleView 同时
      // 收敛分组不变量与「选中集 ⊆ 可见集」不变量。
      const settledView = settleView(state.view, action.result.userData);
      return {
        ...state,
        domain: {
          userData: action.result.userData,
          revision: action.result.revision,
          quotes: state.domain.quotes
        },
        view: settledView,
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
    // 切分组/改过滤词都会换掉「可见集合」，选中集必须一起清空。
    // 否则选中项会活过它引用的那些行：全选 500 → 过滤到 3 行 → 批量移除
    // 仍然按 500 条执行，确认框也照着 500 条写——不可逆的误删。
    case 'view/currentGroup':
      return { ...state, view: { ...state.view, currentGroupId: action.groupId, selectedCodes: [] } };

    case 'view/searchKeyword':
      return { ...state, view: { ...state.view, searchKeyword: action.keyword, selectedCodes: [] } };

    case 'view/selection':
      return { ...state, view: { ...state.view, selectedCodes: action.codes } };

    case 'view/selectionMode':
      return { ...state, view: { ...state.view, selectionMode: action.enabled, selectedCodes: action.enabled ? state.view.selectedCodes : [] } };

    case 'view/clearSelection':
      return { ...state, view: { ...state.view, selectedCodes: [] } };

    case 'view/theme':
      return { ...state, view: { ...state.view, theme: action.theme } };

    case 'view/columns':
      return { ...state, view: { ...state.view, columns: action.columns } };

    // 对话框搜索：独立于工具栏搜索，写 dialogSearch 而非 searchKeyword/searchResults。
    case 'view/dialogSearchKeyword':
      return {
        ...state,
        view: { ...state.view, dialogSearch: { ...state.view.dialogSearch, keyword: action.keyword } }
      };

    // 清空结果（空查询）：同时把 async 归零，否则 combobox 会一直 aria-busy。
    case 'view/dialogSearchResults':
      return {
        ...state,
        view: { ...state.view, dialogSearch: { ...state.view.dialogSearch, results: action.results } },
        async: { ...state.async, stockSearch: { status: 'idle' } }
      };

    // 对话框搜索专用：只更新 generation + loading 状态，绝不写 view.searchKeyword。
    case 'search/dialogRequested':
      return {
        ...state,
        async: {
          ...state.async,
          stockSearch: { status: 'loading' },
          searchGeneration: action.generation
        }
      };

    // 成功落地：stale 响应直接丢弃，否则写结果并把 async 结算为 success
    // （只写 dialogSearch.results 而不结算 async，会让 stockSearch 永远停在 loading）。
    case 'search/dialogConfirmed':
      if (action.generation !== state.async.searchGeneration) return state;
      return {
        ...state,
        view: { ...state.view, dialogSearch: { ...state.view.dialogSearch, results: action.results } },
        async: { ...state.async, stockSearch: { status: 'success' } }
      };

    // 打开对话框：原子重置。递增 generation 让上一次会话的在途响应全部作废，
    // 否则迟到的结果会落进新开的对话框里。
    case 'search/dialogReset':
      return {
        ...state,
        view: { ...state.view, dialogSearch: { keyword: '', results: [] } },
        async: {
          ...state.async,
          stockSearch: { status: 'idle' },
          searchGeneration: state.async.searchGeneration + 1
        }
      };

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
