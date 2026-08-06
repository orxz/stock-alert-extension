// src/popup/store/actions.ts
// AppAction 联合类型：Popup 单向数据流中所有合法的状态变更意图。
// Reducer 是唯一消费者；未知 type 一律返回原 state。
import type { GroupId, StockCode, QuoteSnapshot, StockSearchResult } from '../../domain/index.js';
import type { MutationResult, BootstrapResult } from '../../protocol/index.js';
import type { ClientError, DialogState, MenuState, ToastState } from './state.js';
import type { UiColumnPreferences } from '../ui-preferences.js';

/**
 * AppAction 判别联合：覆盖 bootstrap / quote refresh / search / mutation / view / overlay 全部意图。
 *
 * - mutation/confirmed 的 key 可选（brief Step 1 逐字测试省略 key）；reducer 用 `key ?? '__default__'`。
 * - quote/refresh 与 search 的 confirmed/failed 携带 generation 用于 stale 拒绝。
 */
export type AppAction =
  // bootstrap
  | { readonly type: 'bootstrap/requested' }
  | { readonly type: 'bootstrap/confirmed'; readonly result: BootstrapResult }
  | { readonly type: 'bootstrap/failed'; readonly error: ClientError }
  // quote refresh
  | { readonly type: 'quote/refresh/requested' }
  | { readonly type: 'quote/refresh/confirmed'; readonly snapshot: QuoteSnapshot; readonly generation: number }
  | { readonly type: 'quote/refresh/failed'; readonly error: ClientError; readonly generation: number }
  // search（远程搜索只服务于 add-stock 对话框，见下方 dialog search；
  //   工具栏那条是纯本地过滤，只写 view/searchKeyword，不发 RPC）
  | { readonly type: 'search/failed'; readonly error: ClientError; readonly generation: number }
  // mutation lifecycle
  | { readonly type: 'mutation/pending'; readonly key?: string }
  | { readonly type: 'mutation/uncertain'; readonly key?: string }
  | { readonly type: 'mutation/confirmed'; readonly key?: string; readonly result: MutationResult<unknown> }
  | { readonly type: 'mutation/reconciled'; readonly key?: string }
  | { readonly type: 'mutation/failed'; readonly key?: string; readonly error: ClientError }
  // view
  | { readonly type: 'view/currentGroup'; readonly groupId: GroupId }
  | { readonly type: 'view/searchKeyword'; readonly keyword: string }
  | { readonly type: 'view/selection'; readonly codes: readonly StockCode[] }
  | { readonly type: 'view/selectionMode'; readonly enabled: boolean }
  | { readonly type: 'view/clearSelection' }
  | { readonly type: 'view/theme'; readonly theme: 'dark' | 'light' }
  | { readonly type: 'view/columns'; readonly columns: UiColumnPreferences }
  // dialog search（独立于工具栏过滤，避免对话框搜索时后台列表跳动）
  | { readonly type: 'view/dialogSearchKeyword'; readonly keyword: string }
  | { readonly type: 'view/dialogSearchResults'; readonly results: readonly StockSearchResult[] }
  | { readonly type: 'search/dialogRequested'; readonly generation: number }
  /** 对话框搜索成功落地（带 generation 做 stale 拒绝），并把 async 结算为 success。 */
  | { readonly type: 'search/dialogConfirmed'; readonly results: readonly StockSearchResult[]; readonly generation: number }
  /** 打开对话框时原子重置：清关键词/结果 + 归零 async + 递增 generation 作废在途响应。 */
  | { readonly type: 'search/dialogReset' }
  // overlay
  | { readonly type: 'overlay/dialog'; readonly dialog: DialogState | null }
  | { readonly type: 'overlay/menu'; readonly menu: MenuState | null }
  | { readonly type: 'overlay/toast'; readonly toast: ToastState | null }
  | { readonly type: 'overlay/focusReturn'; readonly id: string | null };
