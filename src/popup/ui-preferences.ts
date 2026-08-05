// src/popup/ui-preferences.ts
// 展示层偏好：列的启用集合与顺序。
//
// 为什么不进 BoardConfig：列显隐是纯展示偏好，不影响任何业务语义，
// 也不该占用 RPC / schema v2 / userDataRevision —— 那条链路上的每次写入
// 都要走乐观并发控制与 SHA-256 摘要。这里用带版本号的 localStorage，
// 读取时一律经 normalizeUiColumns 校验，损坏数据退回默认值而不是崩溃。

/** 可配置的列。 */
export type ColumnKey = 'name' | 'code' | 'status' | 'price' | 'changePercent' | 'amount';

/** 列偏好（带版本号，便于将来迁移）。 */
export interface UiColumnPreferences {
  readonly version: 1;
  readonly enabled: readonly ColumnKey[];
  readonly order: readonly ColumnKey[];
}

/** localStorage 键名。 */
export const UI_COLUMNS_STORAGE_KEY = 'uiColumns:v1';

/** 始终启用的列——关掉它们，列表就不再是股票列表了。 */
export const REQUIRED_COLUMNS = ['name', 'price', 'changePercent'] as const;

/** 默认列偏好。 */
export const DEFAULT_UI_COLUMNS: UiColumnPreferences = Object.freeze({
  version: 1,
  enabled: Object.freeze(['name', 'code', 'status', 'price', 'changePercent', 'amount']),
  order: Object.freeze(['name', 'price', 'changePercent', 'amount', 'code', 'status'])
}) as UiColumnPreferences;

/** 全部已知列（用于校验）。 */
const KNOWN_COLUMNS: readonly ColumnKey[] = DEFAULT_UI_COLUMNS.order;

function isColumnKey(value: unknown): value is ColumnKey {
  return typeof value === 'string' && (KNOWN_COLUMNS as readonly string[]).includes(value);
}

/** 去重 + 只保留已知列。 */
function sanitizeList(value: unknown): ColumnKey[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<ColumnKey>();
  for (const item of value) {
    if (isColumnKey(item)) seen.add(item);
  }
  return [...seen];
}

/**
 * 规范化列偏好：
 * - 版本号不是 1 → 整体退回默认值（未知版本不做猜测）。
 * - enabled：去重、丢弃未知列、强制并入必需列，并按 order 排列。
 * - order：只有当它是全部已知列的完整排列时才采纳；否则退回默认顺序，
 *   避免残缺顺序导致某些列永远排不出来。
 */
export function normalizeUiColumns(value: unknown): UiColumnPreferences {
  const raw = value as Partial<UiColumnPreferences> | null | undefined;
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return DEFAULT_UI_COLUMNS;

  const sanitizedOrder = sanitizeList(raw.order);
  const order: readonly ColumnKey[] =
    sanitizedOrder.length === KNOWN_COLUMNS.length ? sanitizedOrder : DEFAULT_UI_COLUMNS.order;

  const enabledSet = new Set<ColumnKey>(sanitizeList(raw.enabled));
  for (const required of REQUIRED_COLUMNS) enabledSet.add(required);

  return {
    version: 1,
    enabled: order.filter((key) => enabledSet.has(key)),
    order
  };
}

/** 最小 Storage 契约（便于测试注入，也兼容隐私模式下抛错的实现）。 */
export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 读取列偏好；缺失 / 损坏 / 存储不可用一律返回默认值。 */
export function loadUiColumns(storage: WebStorageLike | undefined): UiColumnPreferences {
  if (!storage) return DEFAULT_UI_COLUMNS;
  try {
    const raw = storage.getItem(UI_COLUMNS_STORAGE_KEY);
    if (!raw) return DEFAULT_UI_COLUMNS;
    return normalizeUiColumns(JSON.parse(raw));
  } catch {
    // JSON 损坏 / 隐私模式禁止读取——展示偏好不值得让 Popup 崩掉。
    return DEFAULT_UI_COLUMNS;
  }
}

/** 写入列偏好（只写规范化后的值）；配额或隐私模式失败时静默忽略。 */
export function saveUiColumns(
  storage: WebStorageLike | undefined,
  columns: UiColumnPreferences
): void {
  if (!storage) return;
  try {
    storage.setItem(UI_COLUMNS_STORAGE_KEY, JSON.stringify(normalizeUiColumns(columns)));
  } catch {
    /* 配额超限 / 隐私模式：偏好丢失可接受，不影响主流程 */
  }
}
