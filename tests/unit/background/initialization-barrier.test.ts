// tests/unit/background/initialization-barrier.test.ts
// Task 10 — 三态可重试初始化屏障：idle → running → ready；失败回 idle（不缓存错误）；
// 并发首事件共享同一次 attempt；ready 后缓存值不再重新初始化。
import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitializationBarrier } from '../../../src/background/initialization-barrier.js';

const services = { tag: 'ready' };

test('failed initialization returns to idle and the next event retries', async () => {
  let calls = 0;
  const barrier = createInitializationBarrier(async () => {
    calls += 1;
    if (calls === 1) throw new Error('storage unavailable');
    return services;
  });
  await assert.rejects(barrier.get(), /storage unavailable/);
  assert.equal(await barrier.get(), services);
  assert.equal(calls, 2);
});

test('concurrent first events share one attempt', async () => {
  let calls = 0;
  let resolveInit!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    resolveInit = resolve;
  });
  const barrier = createInitializationBarrier(async () => {
    calls += 1;
    return pending as Promise<typeof services>;
  });
  const a = barrier.get();
  const b = barrier.get();
  // 两个并发 get() 都在 running 态共享同一次 attempt，初始化只触发一次。
  assert.equal(calls, 1);
  resolveInit(services);
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra, services);
  assert.equal(rb, services);
  assert.equal(calls, 1);
});

test('ready state caches value without re-initializing', async () => {
  let calls = 0;
  const barrier = createInitializationBarrier(async () => {
    calls += 1;
    return services;
  });
  assert.equal(await barrier.get(), services);
  assert.equal(await barrier.get(), services);
  assert.equal(await barrier.get(), services);
  assert.equal(calls, 1);
});

test('second failure after first failure still retries on next event', async () => {
  let calls = 0;
  const barrier = createInitializationBarrier(async () => {
    calls += 1;
    if (calls < 3) throw new Error(`fail ${calls}`);
    return services;
  });
  await assert.rejects(barrier.get(), /fail 1/);
  await assert.rejects(barrier.get(), /fail 2/);
  assert.equal(await barrier.get(), services);
  assert.equal(calls, 3);
});
