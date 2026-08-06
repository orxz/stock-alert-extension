// tests/unit/infrastructure/chrome-storage-adapter.test.ts
// ChromeStorageAdapter 适配器测试：通过 globalThis.chrome 模拟验证 get/set/remove 委托。
import assert from 'node:assert/strict';
import test from 'node:test';

import { ChromeStorageAdapter, createChromeStorageArea } from '../../../src/infrastructure/storage/chrome-storage-adapter.js';

/** 内存版 chrome.storage.local mock。 */
function mockChromeStorage() {
  const store: Record<string, unknown> = {};
  const chromeStorageLocal = {
    async get(keys?: string | string[] | object | null): Promise<Record<string, unknown>> {
      if (keys === undefined || keys === null) return { ...store };
      if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const k of keys) if (k in store) result[k] = store[k];
        return result;
      }
      return { ...store };
    },
    async set(patch: Record<string, unknown>): Promise<void> {
      Object.assign(store, patch);
    },
    async remove(keys: string | string[]): Promise<void> {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) delete store[k];
    }
  };
  (globalThis as Record<string, unknown>).chrome = { storage: { local: chromeStorageLocal } };
  return store;
}

test('ChromeStorageAdapter.get delegates to chrome.storage.local.get', async () => {
  const store = mockChromeStorage();
  store['key1'] = 'val1';
  const adapter = new ChromeStorageAdapter();
  const result = await adapter.get(['key1', 'key2']);
  assert.equal(result['key1'], 'val1');
  assert.equal(result['key2'], undefined);
});

test('ChromeStorageAdapter.set delegates to chrome.storage.local.set', async () => {
  const store = mockChromeStorage();
  const adapter = new ChromeStorageAdapter();
  await adapter.set({ foo: 'bar', num: 42 });
  assert.equal(store['foo'], 'bar');
  assert.equal(store['num'], 42);
});

test('ChromeStorageAdapter.remove delegates to chrome.storage.local.remove', async () => {
  const store = mockChromeStorage();
  store['a'] = 1;
  store['b'] = 2;
  const adapter = new ChromeStorageAdapter();
  await adapter.remove(['a']);
  assert.equal(store['a'], undefined);
  assert.equal(store['b'], 2);
  // remove single string
  await adapter.remove('b');
  assert.equal(store['b'], undefined);
});

test('createChromeStorageArea returns a ChromeStorageAdapter instance', async () => {
  mockChromeStorage();
  const area = createChromeStorageArea();
  assert.ok(area instanceof ChromeStorageAdapter);
  await area.set({ x: 1 });
  const result = await area.get(['x']);
  assert.equal(result['x'], 1);
});

// ===== getKeys：Chrome 130+ 原生接口 + 低版本回退 =====

test('getKeys uses the native chrome.storage.local.getKeys when present', async () => {
  const store = mockChromeStorage();
  store['a'] = 1;
  store['quoteCache:sh600519'] = { big: 'payload' };
  let nativeCalls = 0;
  let getCalls = 0;
  const local = (globalThis as unknown as {
    chrome: { storage: { local: Record<string, unknown> } };
  }).chrome.storage.local;
  const originalGet = local.get as (...args: unknown[]) => Promise<unknown>;
  local.get = async (...args: unknown[]) => { getCalls += 1; return originalGet(...args); };
  local.getKeys = async () => { nativeCalls += 1; return Object.keys(store); };

  const adapter = new ChromeStorageAdapter();
  const keys = await adapter.getKeys();

  assert.equal(nativeCalls, 1, 'native getKeys called');
  assert.equal(getCalls, 0, 'values are never fetched');
  assert.deepEqual([...keys].sort(), ['a', 'quoteCache:sh600519']);
});

test('getKeys falls back to a full get on Chrome versions without it', async () => {
  const store = mockChromeStorage();
  store['a'] = 1;
  store['quoteCache:sh600519'] = { big: 'payload' };
  // 不定义 local.getKeys —— 模拟 Chrome < 130。
  const adapter = new ChromeStorageAdapter();
  const keys = await adapter.getKeys();

  assert.deepEqual([...keys].sort(), ['a', 'quoteCache:sh600519']);
});
