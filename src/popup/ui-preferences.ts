export type ColumnKey = 'name' | 'code' | 'status' | 'price' | 'changePercent' | 'amount';

export interface UiColumnPreferences {
  readonly version: 1;
  readonly enabled: readonly ColumnKey[];
  readonly order: readonly ColumnKey[];
}

export interface UiColumnsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const UI_COLUMNS_STORAGE_KEY = 'uiColumns:v1';
export const REQUIRED_COLUMNS = ['name', 'price', 'changePercent'] as const;
export const DEFAULT_UI_COLUMNS: UiColumnPreferences = {
  version: 1,
  enabled: ['name', 'code', 'status', 'price', 'changePercent', 'amount'],
  order: ['name', 'price', 'changePercent', 'amount', 'code', 'status']
};

const COLUMN_KEYS: readonly ColumnKey[] = ['name', 'code', 'status', 'price', 'changePercent', 'amount'];
const COLUMN_KEY_SET = new Set<string>(COLUMN_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueColumns(value: readonly unknown[]): ColumnKey[] {
  const result: ColumnKey[] = [];
  const seen = new Set<ColumnKey>();
  for (const candidate of value) {
    if (typeof candidate !== 'string' || !COLUMN_KEY_SET.has(candidate)) continue;
    const column = candidate as ColumnKey;
    if (seen.has(column)) continue;
    seen.add(column);
    result.push(column);
  }
  return result;
}

function addMissingRequired(columns: readonly ColumnKey[]): ColumnKey[] {
  const present = new Set(columns);
  return [
    ...REQUIRED_COLUMNS.filter((column) => !present.has(column)),
    ...columns
  ];
}

export function normalizeUiColumns(value: unknown): UiColumnPreferences {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.enabled) || !Array.isArray(value.order)) {
    return DEFAULT_UI_COLUMNS;
  }

  const enabled = addMissingRequired(uniqueColumns(value.enabled));
  const partialOrder = addMissingRequired(uniqueColumns(value.order));
  const ordered = new Set(partialOrder);
  const order = [...partialOrder, ...DEFAULT_UI_COLUMNS.order.filter((column) => !ordered.has(column))];

  return { version: 1, enabled, order };
}

export function loadUiColumns(storage: UiColumnsStorage): UiColumnPreferences {
  try {
    const serialized = storage.getItem(UI_COLUMNS_STORAGE_KEY);
    if (serialized === null) return DEFAULT_UI_COLUMNS;
    return normalizeUiColumns(JSON.parse(serialized));
  } catch {
    return DEFAULT_UI_COLUMNS;
  }
}

export function saveUiColumns(storage: UiColumnsStorage, columns: unknown): void {
  try {
    storage.setItem(UI_COLUMNS_STORAGE_KEY, JSON.stringify(normalizeUiColumns(columns)));
  } catch {
    // localStorage can throw in privacy mode or when quota is exhausted.
  }
}
