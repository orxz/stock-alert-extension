// src/popup/components/events.ts
import type { StockCode, GroupId } from '../../domain/brands.js';
import type { BoardConfig } from '../../domain/board-config.js';
import type { UiColumnPreferences } from '../ui-preferences.js';

export type ViewMode = 'grid' | 'list';

export type DialogSubmitDetail =
  | { readonly kind: 'add-stock'; readonly code: StockCode; readonly name: string; readonly groupIds: readonly GroupId[] }
  | { readonly kind: 'create-group'; readonly name: string }
  | { readonly kind: 'rename-group'; readonly groupId: GroupId; readonly name: string }
  | { readonly kind: 'delete-group'; readonly groupId: GroupId }
  | { readonly kind: 'move-stocks'; readonly codes: readonly StockCode[]; readonly fromGroupId: GroupId; readonly targetGroupIds: readonly GroupId[] }
  | { readonly kind: 'remove-stocks'; readonly codes: readonly StockCode[]; readonly groupId: GroupId };

export interface PopupEventMap {
  'group-select': { readonly groupId: GroupId };
  'group-order-request': { readonly orderedGroupIds: readonly GroupId[] };
  'stock-pin-request': { readonly code: StockCode; readonly pinned: boolean; readonly orderedCodes: readonly StockCode[] };
  'stock-remove-request': { readonly codes: readonly StockCode[]; readonly groupId: GroupId };
  'stock-order-request': { readonly groupId: GroupId; readonly orderedCodes: readonly StockCode[] };
  'batch-move-request': { readonly codes: readonly StockCode[]; readonly fromGroupId: GroupId; readonly targetGroupIds: readonly GroupId[] };
  'view-mode-change': { readonly viewMode: ViewMode };
  /** BoardConfig 业务偏好（走 RPC 持久化）。列显隐见 column-settings-change。 */
  'preferences-change': { readonly patch: Readonly<Partial<BoardConfig>> };
  'selection-mode-change': { readonly enabled: boolean };
  'theme-change': { readonly theme: 'dark' | 'light' };
  'stock-toggle-select': { readonly code: StockCode };
  'search-keyword-change': { readonly keyword: string };
  'dialog-open-request': { readonly kind: 'add-stock' | 'create-group' | 'rename-group' | 'move-stocks' | 'confirm-remove' };
  /** 工具栏「列设置」触发；detail 带触发元素 id 以便定位与焦点归还。 */
  'column-panel-open-request': { readonly anchorId: string };
  /** 列设置面板提交完整的最终态（非增量 patch）。 */
  'column-settings-change': { readonly columns: UiColumnPreferences };
  /** 请求关闭当前 popover。 */
  'popover-close-request': Record<never, never>;
  'dialog-submit': DialogSubmitDetail;
  'dialog-close-request': { readonly reason: 'cancel' | 'escape' | 'backdrop' };
  'stock-search-select': { readonly code: StockCode; readonly name: string };
  'quote-refresh-request': { readonly force: true };
  /**
   * 虚拟列表请求把某个索引滚入视口。
   * 由 list/grid 发出、stock-board（唯一滚动拥有者）处理——目标行可能
   * 尚未挂载，必须先滚动再聚焦。
   */
  'virtual-focus-request': { readonly index: number; readonly itemExtent: number };
}

export function emitPopupEvent<K extends keyof PopupEventMap>(
  target: EventTarget,
  type: K,
  detail: PopupEventMap[K]
): boolean {
  return target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
