// src/domain/board-config.ts
// 看板配置类型与 UserData 根聚合。BoardConfig 是看板偏好的唯一真相。
import type { GroupId } from './brands.js';
import type { Group } from './group.js';
import type { Stock } from './stock.js';

/** 视图模式：列表或网格。 */
export type ViewMode = 'list' | 'grid';

/** 排序字段：manual/addedAt/name 取自股票自身，price/change/changePercent/amount 取自行情。 */
export type SortField = 'manual' | 'addedAt' | 'name' | 'price' | 'change' | 'changePercent' | 'amount';

/** 排序方向。注意 manual 字段不受 direction 影响（始终按 manualOrder 升序）。 */
export type SortDirection = 'asc' | 'desc';

/**
 * 看板配置：每个分组独立的视图与排序偏好。
 * 从 domain.boardConfig[currentGroupId] 派生当前视图偏好。
 */
export interface BoardConfig {
  readonly viewMode: ViewMode;
  readonly sortField: SortField;
  readonly sortDirection: SortDirection;
  readonly priceHidden: boolean;
}

/**
 * UserData 根聚合：用户数据的完整快照（schema v2）。
 * revision 是规范化内容的 SHA-256 摘要，不作为独立 Storage key 持久化。
 */
export interface UserData {
  readonly schemaVersion: 2;
  readonly groups: readonly Group[];
  readonly watchlist: readonly Stock[];
  readonly boardConfig: Readonly<Record<GroupId, BoardConfig>>;
}
