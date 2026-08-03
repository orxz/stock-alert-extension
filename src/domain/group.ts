// src/domain/group.ts
// 分组实体：`g_all` 是固定计算视图，自定义分组由 Popup 生成 groupId。
import type { GroupId } from './brands.js';

/**
 * 分组实体：用户自定义的股票集合。
 * `g_all` 作为计算视图始终打头（order: 0, isDefault: true），但不写入任何 stock.groupIds。
 */
export interface Group {
  readonly groupId: GroupId;
  readonly name: string;
  readonly order: number;
  readonly isDefault: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}
