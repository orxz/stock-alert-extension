// src/popup/components/events.ts
import type { StockCode, GroupId } from '../../domain/brands.js';
import type { BoardConfig } from '../../domain/board-config.js';

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
  'preferences-change': {
    readonly patch: Readonly<Partial<BoardConfig>>;
    readonly columns?: readonly string[];
    readonly columnOrder?: readonly string[];
  };
  'selection-mode-change': { readonly enabled: boolean };
  'search-keyword-change': { readonly keyword: string };
  'dialog-open-request': { readonly kind: 'add-stock' | 'create-group' | 'rename-group' | 'move-stocks' | 'confirm-remove' };
  'column-panel-open-request': Record<never, never>;
  'dialog-submit': DialogSubmitDetail;
  'dialog-close-request': { readonly reason: 'cancel' | 'escape' | 'backdrop' };
  'stock-search-select': { readonly code: StockCode; readonly name: string };
  'quote-refresh-request': { readonly force: true };
}

export function emitPopupEvent<K extends keyof PopupEventMap>(
  target: EventTarget,
  type: K,
  detail: PopupEventMap[K]
): boolean {
  return target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
