// src/popup/store/state.ts
// Popup 不可变 AppState：domain / view / async / overlay 四区。
// 纯数据——不含 DOM 节点 / Promise / timer / AbortController / class instance / 可变 Set/Map。
// 唯一状态写入口是 reducer；Selector 只读派生。
import type { GroupId, StockCode, UserDataRevision, UserData, QuoteSnapshot, StockSearchResult } from '../../domain/index.js';
import { DEFAULT_UI_COLUMNS } from '../ui-preferences.js';
import type { UiColumnPreferences } from '../ui-preferences.js';

/**
 * Popup 端错误表示：稳定 code（字符串，兼容任意错误码）+ 安全文案 + 可重试标记。
 * 与 domain.AppError 结构一致，但 code 放宽为 string 以承载客户端未知错误码。
 */
export interface ClientError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/** 异步操作状态：bootstrap / quoteRefresh / stockSearch 共用。 */
export interface AsyncState {
  readonly status: 'idle' | 'loading' | 'success' | 'error';
  readonly error?: ClientError;
}

/** 写命令异步状态：idle → pending → (uncertain | failed)；confirmed/reconciled 后从 mutations 表移除。 */
export interface MutationAsyncState {
  readonly status: 'idle' | 'pending' | 'uncertain' | 'failed';
  readonly error?: ClientError;
}

/** 对话框状态：判别联合，按 kind 携带各自上下文。 */
export type DialogState =
  | { readonly kind: 'add-stock' }
  | { readonly kind: 'create-group' }
  | { readonly kind: 'rename-group'; readonly groupId: GroupId; readonly currentName: string }
  | { readonly kind: 'move-stocks'; readonly codes: readonly StockCode[]; readonly fromGroupId: GroupId }
  | { readonly kind: 'confirm-remove'; readonly codes: readonly StockCode[]; readonly groupId: GroupId };

/**
 * 弹出层状态（可判别联合）。
 * anchorId 指向触发元素的 id——popover 由它定位，关闭时把焦点还回去。
 */
export type MenuState =
  | { readonly kind: 'column-settings'; readonly anchorId: string }
  | { readonly kind: 'stock-actions'; readonly anchorId: string; readonly code: StockCode };

/** Toast 通知。 */
export interface ToastState {
  readonly message: string;
  readonly kind: 'info' | 'success' | 'error';
}

/**
 * 应用全局不可变状态（brief Step 3 逐字四区）。
 * async 区额外携带 quoteGeneration / searchGeneration 用于 stale 响应拒绝；
 * view 区额外携带 dialogSearch 驱动 add-stock 对话框的搜索渲染。
 */
export interface AppState {
  readonly domain: Readonly<{
    userData: UserData;
    revision: UserDataRevision;
    quotes: QuoteSnapshot;
  }>;
  readonly view: Readonly<{
    currentGroupId: GroupId;
    /** 工具栏列表过滤关键词（与对话框搜索独立）。 */
    searchKeyword: string;
    selectionMode: boolean;
    selectedCodes: readonly StockCode[];
    theme: 'dark' | 'light';
    /** 列显隐/顺序——纯展示偏好，不进 BoardConfig / schema v2 / RPC。 */
    columns: UiColumnPreferences;
    /** 对话框内股票搜索（add-stock）：独立于工具栏过滤，避免互相干扰。 */
    dialogSearch: Readonly<{
      keyword: string;
      results: readonly StockSearchResult[];
    }>;
  }>;
  readonly async: Readonly<{
    bootstrap: AsyncState;
    quoteRefresh: AsyncState;
    stockSearch: AsyncState;
    mutations: Readonly<Record<string, MutationAsyncState>>;
    quoteGeneration: number;
    searchGeneration: number;
  }>;
  readonly overlay: Readonly<{
    dialog: DialogState | null;
    menu: MenuState | null;
    toast: ToastState | null;
    focusReturnId: string | null;
  }>;
}

/** 空行情快照（generation 0，无任何结果）。 */
const EMPTY_SNAPSHOT: QuoteSnapshot = {
  results: {},
  counts: { fresh: 0, cached: 0, missing: 0 },
  attemptedAt: 0,
  succeededAt: null,
  generation: 0
};

/** 安全的空初始态：g_all 计算视图打头，空 watchlist，所有 async idle，无 overlay。 */
export function createInitialState(
  theme: 'dark' | 'light' = 'dark',
  columns: UiColumnPreferences = DEFAULT_UI_COLUMNS
): AppState {
  return {
    domain: {
      userData: {
        schemaVersion: 2,
        groups: [
          { groupId: 'g_all' as GroupId, name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 }
        ],
        watchlist: [],
        boardConfig: {}
      },
      revision: '' as UserDataRevision,
      quotes: EMPTY_SNAPSHOT
    },
    view: {
      currentGroupId: 'g_all' as GroupId,
      searchKeyword: '',
      selectionMode: false,
      selectedCodes: [],
      theme,
      columns,
      dialogSearch: { keyword: '', results: [] }
    },
    async: {
      bootstrap: { status: 'idle' },
      quoteRefresh: { status: 'idle' },
      stockSearch: { status: 'idle' },
      mutations: {},
      quoteGeneration: 0,
      searchGeneration: 0
    },
    overlay: {
      dialog: null,
      menu: null,
      toast: null,
      focusReturnId: null
    }
  };
}
