import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_UI_COLUMNS,
  UI_COLUMNS_STORAGE_KEY,
  loadUiColumns,
  normalizeUiColumns,
  saveUiColumns
} from '../../../src/popup/ui-preferences.js';

test('normalizes corrupt, duplicate, and unknown columns', () => {
  assert.deepEqual(normalizeUiColumns({
    version: 1,
    enabled: ['amount', 'amount', 'unknown'],
    order: ['amount', 'unknown']
  }), {
    version: 1,
    enabled: ['name', 'price', 'changePercent', 'amount'],
    order: ['name', 'price', 'changePercent', 'amount', 'code', 'status']
  });
});

test('unknown versions fall back to defaults', () => {
  assert.deepEqual(normalizeUiColumns({ version: 2, enabled: [], order: [] }), DEFAULT_UI_COLUMNS);
});

test('non-object and malformed version 1 values fall back to defaults', () => {
  assert.deepEqual(normalizeUiColumns(null), DEFAULT_UI_COLUMNS);
  assert.deepEqual(normalizeUiColumns({ version: 1, enabled: 'name', order: [] }), DEFAULT_UI_COLUMNS);
  assert.deepEqual(normalizeUiColumns({ version: 1, enabled: [], order: 'name' }), DEFAULT_UI_COLUMNS);
});

test('loadUiColumns parses and normalizes persisted preferences', () => {
  const storage = {
    getItem(key: string): string | null {
      assert.equal(key, 'uiColumns:v1');
      return JSON.stringify({ version: 1, enabled: ['status'], order: ['status'] });
    },
    setItem(): void {}
  };

  assert.deepEqual(loadUiColumns(storage), {
    version: 1,
    enabled: ['name', 'price', 'changePercent', 'status'],
    order: ['name', 'price', 'changePercent', 'status', 'amount', 'code']
  });
});

test('loadUiColumns safely returns defaults for missing, corrupt, or inaccessible storage', () => {
  const missing = { getItem: () => null, setItem(): void {} };
  const corrupt = { getItem: () => '{', setItem(): void {} };
  const inaccessible = { getItem(): string { throw new Error('privacy'); }, setItem(): void {} };

  assert.deepEqual(loadUiColumns(missing), DEFAULT_UI_COLUMNS);
  assert.deepEqual(loadUiColumns(corrupt), DEFAULT_UI_COLUMNS);
  assert.deepEqual(loadUiColumns(inaccessible), DEFAULT_UI_COLUMNS);
});

test('saveUiColumns writes normalized versioned JSON under the exact key', () => {
  let savedKey = '';
  let savedValue = '';
  const storage = {
    getItem: () => null,
    setItem(key: string, value: string): void {
      savedKey = key;
      savedValue = value;
    }
  };

  assert.doesNotThrow(() => saveUiColumns(storage, {
    version: 1,
    enabled: ['code'],
    order: ['code']
  }));
  assert.equal(savedKey, UI_COLUMNS_STORAGE_KEY);
  assert.deepEqual(JSON.parse(savedValue), {
    version: 1,
    enabled: ['name', 'price', 'changePercent', 'code'],
    order: ['name', 'price', 'changePercent', 'code', 'amount', 'status']
  });
});

test('saveUiColumns absorbs storage quota and privacy errors', () => {
  const storage = {
    getItem: () => null,
    setItem(): void { throw new Error('quota'); }
  };

  assert.doesNotThrow(() => saveUiColumns(storage, DEFAULT_UI_COLUMNS));
});
