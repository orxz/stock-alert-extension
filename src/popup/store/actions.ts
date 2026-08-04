// src/popup/store/actions.ts
// AppAction 联合类型：Popup 单向数据流中所有合法的状态变更意图。
// Reducer 是唯一消费者；未知 type 一律返回原 state。
import type { GroupId, StockCode, QuoteSnapshot, StockSearchResult } from '../../domain/index.js';
import type { MutationResult, BootstrapResult } from '../../protocol/index.js';
import type { ClientError, DialogState, MenuState, ToastState } from './state.js';

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
  // search
  | { readonly type: 'search/keyword'; readonly keyword: string }
  | { readonly type: 'search/requested'; readonly query: string; readonly generation: number }
  | { readonly type: 'search/confirmed'; readonly results: readonly StockSearchResult[]; readonly generation: number }
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
  | { readonly type: 'view/clearSelection' }
  // overlay
  | { readonly type: 'overlay/dialog'; readonly dialog: DialogState | null }
  | { readonly type: 'overlay/menu'; readonly menu: MenuState | null }
  | { readonly type: 'overlay/toast'; readonly toast: ToastState | null }
  | { readonly type: 'overlay/focusReturn'; readonly id: string | null };
