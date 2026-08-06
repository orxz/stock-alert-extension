// tests/unit/infrastructure/chrome-session-state.test.ts
// Task 9 — ChromeSessionState：读写 `quoteBackoff:v2`、clamp 非法值。
// 测试通过 globalThis.chrome 模拟 chrome.storage.session。
import assert from 'node:assert/strict';
import test from 'node:test';

import { ChromeSessionState } from '../../../src/infrastructure/chrome/chrome-session-state.js';

const NOW = 1_700_000_000;

/** 模拟 chrome.storage.session（内存版）。 */
function mockChromeSession(initial: Record<string, unknown> = {}): Record<string, unknown> {
  const data: Record<string, unknown> = structuredClone(initial);
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      session: {
        async get(keys: string | string[] | null) {
          if (keys === null || keys === undefined) return structuredClone(data);
          const list = typeof keys === 'string' ? [keys] : keys;
          const result: Record<string, unknown> = {};
          for (const key of list) {
            if (key in data) result[key] = structuredClone(data[key]);
          }
          return result;
        },
        async set(patch: Record<string, unknown>) {
          for (const [key, value] of Object.entries(patch)) {
            data[key] = structuredClone(value);
          }
        },
        async remove(keys: string | string[]) {
          const list = typeof keys === 'string' ? [keys] : keys;
          for (const key of list) delete data[key];
        }
      }
    }
  };
  return data;
}

/** 清理 globalThis.chrome。 */
function cleanupChrome(): void {
  delete (globalThis as Record<string, unknown>).chrome;
}

// ===== 读写 round-trip =====

test('ChromeSessionState writes and reads quoteBackoff:v2', async () => {
  const data = mockChromeSession();
  try {
    const state = new ChromeSessionState();
    await state.writeQuoteBackoff({ failureCount: 2, nextAutomaticAttemptAt: NOW + 60_000 });
    const result = await state.readQuoteBackoff();
    assert.equal(result.failureCount, 2);
    assert.equal(result.nextAutomaticAttemptAt, NOW + 60_000);
    // 验证存储键
    assert.ok('quoteBackoff:v2' in data);
    const raw = data['quoteBackoff:v2'] as Record<string, unknown>;
    assert.equal(raw.failureCount, 2);
    assert.equal(raw.nextAutomaticAttemptAt, NOW + 60_000);
  } finally {
    cleanupChrome();
  }
});

// ===== 键缺失返回零值 =====

test('ChromeSessionState returns zeros when key missing', async () => {
  mockChromeSession();
  try {
    const state = new ChromeSessionState();
    const result = await state.readQuoteBackoff();
    assert.equal(result.failureCount, 0);
    assert.equal(result.nextAutomaticAttemptAt, 0);
  } finally {
    cleanupChrome();
  }
});

// ===== clamp 负数 failureCount =====

test('ChromeSessionState clamps negative failureCount to zero', async () => {
  mockChromeSession({
    'quoteBackoff:v2': { failureCount: -3, nextAutomaticAttemptAt: NOW }
  });
  try {
    const state = new ChromeSessionState();
    const result = await state.readQuoteBackoff();
    assert.equal(result.failureCount, 0);
    assert.equal(result.nextAutomaticAttemptAt, NOW);
  } finally {
    cleanupChrome();
  }
});

// ===== clamp 非数字 nextAutomaticAttemptAt =====

test('ChromeSessionState clamps non-numeric nextAutomaticAttemptAt to zero', async () => {
  mockChromeSession({
    'quoteBackoff:v2': { failureCount: 1, nextAutomaticAttemptAt: 'bad' as unknown }
  });
  try {
    const state = new ChromeSessionState();
    const result = await state.readQuoteBackoff();
    assert.equal(result.failureCount, 1);
    assert.equal(result.nextAutomaticAttemptAt, 0);
  } finally {
    cleanupChrome();
  }
});

// ===== clamp NaN =====

test('ChromeSessionState clamps NaN values to zero', async () => {
  mockChromeSession({
    'quoteBackoff:v2': { failureCount: NaN, nextAutomaticAttemptAt: NaN }
  });
  try {
    const state = new ChromeSessionState();
    const result = await state.readQuoteBackoff();
    assert.equal(result.failureCount, 0);
    assert.equal(result.nextAutomaticAttemptAt, 0);
  } finally {
    cleanupChrome();
  }
});

// ===== clamp Infinity =====

test('ChromeSessionState clamps Infinity failureCount to zero', async () => {
  mockChromeSession({
    'quoteBackoff:v2': { failureCount: Infinity, nextAutomaticAttemptAt: Infinity }
  });
  try {
    const state = new ChromeSessionState();
    const result = await state.readQuoteBackoff();
    assert.equal(result.failureCount, 0);
    assert.equal(result.nextAutomaticAttemptAt, 0);
  } finally {
    cleanupChrome();
  }
});

// ===== clamp 非对象 =====

test('ChromeSessionState clamps non-object to zeros', async () => {
  mockChromeSession({ 'quoteBackoff:v2': 'invalid' });
  try {
    const state = new ChromeSessionState();
    const result = await state.readQuoteBackoff();
    assert.equal(result.failureCount, 0);
    assert.equal(result.nextAutomaticAttemptAt, 0);
  } finally {
    cleanupChrome();
  }
});

// ===== clamp null =====

test('ChromeSessionState clamps null to zeros', async () => {
  mockChromeSession({ 'quoteBackoff:v2': null });
  try {
    const state = new ChromeSessionState();
    const result = await state.readQuoteBackoff();
    assert.equal(result.failureCount, 0);
    assert.equal(result.nextAutomaticAttemptAt, 0);
  } finally {
    cleanupChrome();
  }
});

// ===== 覆盖写入（先写再读确认覆盖） =====

test('ChromeSessionState overwrites previous state', async () => {
  mockChromeSession({
    'quoteBackoff:v2': { failureCount: 5, nextAutomaticAttemptAt: NOW + 999 }
  });
  try {
    const state = new ChromeSessionState();
    await state.writeQuoteBackoff({ failureCount: 0, nextAutomaticAttemptAt: 0 });
    const result = await state.readQuoteBackoff();
    assert.equal(result.failureCount, 0);
    assert.equal(result.nextAutomaticAttemptAt, 0);
  } finally {
    cleanupChrome();
  }
});

// ===== 浮点 failureCount 向下取整 =====

test('ChromeSessionState floors fractional failureCount', async () => {
  mockChromeSession({
    'quoteBackoff:v2': { failureCount: 2.9, nextAutomaticAttemptAt: NOW }
  });
  try {
    const state = new ChromeSessionState();
    const result = await state.readQuoteBackoff();
    assert.equal(result.failureCount, 2);
  } finally {
    cleanupChrome();
  }
});
