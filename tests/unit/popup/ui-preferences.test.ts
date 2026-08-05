// tests/unit/popup/ui-preferences.test.ts
// 计划 Task 5 — 列偏好的校验与持久化。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_UI_COLUMNS,
  UI_COLUMNS_STORAGE_KEY,
  loadUiColumns,
  normalizeUiColumns,
  saveUiColumns
} from '../../../src/popup/ui-preferences.js';
import type { WebStorageLike } from '../../../src/popup/ui-preferences.js';

/** 内存 storage，可选注入抛错行为（模拟隐私模式 / 配额超限）。 */
function memoryStorage(throwOn?: 'get' | 'set'): WebStorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key) {
      if (throwOn === 'get') throw new Error('storage disabled');
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (throwOn === 'set') throw new Error('quota exceeded');
      data.set(key, value);
    }
  };
}

test('normalizes corrupt, duplicate, and unknown columns', () => {
  assert.deepEqual(
    normalizeUiColumns({
      version: 1,
      enabled: ['amount', 'amount', 'unknown'],
      order: ['amount', 'unknown']
    }),
    {
      version: 1,
      enabled: ['name', 'price', 'changePercent', 'amount'],
      order: ['name', 'price', 'changePercent', 'amount', 'code', 'status']
    }
  );
});

test('unknown versions fall back to defaults', () => {
  assert.deepEqual(normalizeUiColumns({ version: 2, enabled: [], order: [] }), DEFAULT_UI_COLUMNS);
});

test('non-object input falls back to defaults', () => {
  for (const input of [null, undefined, 'nope', 42, []]) {
    assert.deepEqual(normalizeUiColumns(input), DEFAULT_UI_COLUMNS);
  }
});

test('required columns cannot be disabled', () => {
  const result = normalizeUiColumns({ version: 1, enabled: ['code'], order: DEFAULT_UI_COLUMNS.order });
  for (const required of ['name', 'price', 'changePercent']) {
    assert.ok(result.enabled.includes(required as never), `${required} forced back on`);
  }
});

test('a complete custom order is preserved', () => {
  const custom = ['amount', 'name', 'price', 'changePercent', 'status', 'code'] as const;
  const result = normalizeUiColumns({ version: 1, enabled: [...custom], order: [...custom] });
  assert.deepEqual(result.order, [...custom]);
  // enabled 跟随 order 排列，保证渲染顺序与配置顺序一致。
  assert.deepEqual(result.enabled, [...custom]);
});

test('enabled is always ordered by the column order', () => {
  const result = normalizeUiColumns({
    version: 1,
    enabled: ['amount', 'name'],
    order: DEFAULT_UI_COLUMNS.order
  });
  assert.deepEqual(result.enabled, ['name', 'price', 'changePercent', 'amount']);
});

test('load returns defaults for missing, corrupt, and unreadable storage', () => {
  assert.deepEqual(loadUiColumns(memoryStorage()), DEFAULT_UI_COLUMNS);

  const corrupt = memoryStorage();
  corrupt.data.set(UI_COLUMNS_STORAGE_KEY, '{not json');
  assert.deepEqual(loadUiColumns(corrupt), DEFAULT_UI_COLUMNS);

  assert.deepEqual(loadUiColumns(memoryStorage('get')), DEFAULT_UI_COLUMNS);
  assert.deepEqual(loadUiColumns(undefined), DEFAULT_UI_COLUMNS);
});

test('save writes normalized json and survives a failing storage', () => {
  const storage = memoryStorage();
  saveUiColumns(storage, {
    version: 1,
    enabled: ['amount', 'amount'] as never,
    order: [] as never
  });
  const written = JSON.parse(storage.data.get(UI_COLUMNS_STORAGE_KEY) ?? '{}');
  assert.deepEqual(written.order, [...DEFAULT_UI_COLUMNS.order], 'stored value is already normalized');
  assert.ok(written.enabled.includes('name'));

  assert.doesNotThrow(() => saveUiColumns(memoryStorage('set'), DEFAULT_UI_COLUMNS));
  assert.doesNotThrow(() => saveUiColumns(undefined, DEFAULT_UI_COLUMNS));
});

test('round-trips through storage', () => {
  const storage = memoryStorage();
  const custom = normalizeUiColumns({
    version: 1,
    enabled: ['name', 'price', 'changePercent'],
    order: DEFAULT_UI_COLUMNS.order
  });
  saveUiColumns(storage, custom);
  assert.deepEqual(loadUiColumns(storage), custom);
});
