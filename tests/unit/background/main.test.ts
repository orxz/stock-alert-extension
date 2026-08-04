// tests/unit/background/main.test.ts
// Task 11 — main.ts listener 接线验证（可选，依赖 Chrome mock）：
// 验证 onAlarm/onInstalled/onStartup/onStorageChanged 接入 scheduler.runQuoteCycle。
// 验证 quoteCache 变更不触发行情刷新 cycle。
import assert from 'node:assert/strict';
import test from 'node:test';

import { installChromeMock } from '../../helpers/chrome-runtime-mock.js';
import { ALARM_NAME } from '../../../src/background/scheduler.js';

// ── 在导入 main.ts 之前安装 Chrome mock ──
const chromeMock = installChromeMock();

/** 等待谓词为真（500 次微任务轮询，容忍并发测试负载）。 */
async function waitFor(predicate: () => boolean, maxIterations = 500): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('waitFor timeout');
}

/** 让异步操作沉淀（100 次 setImmediate 让出微任务槽）。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// main.ts 只导入一次——后续 test 共享已注册的 listener。
let mainImported = false;
async function ensureMainImported(): Promise<void> {
  if (!mainImported) {
    await import('../../../src/background/main.js');
    mainImported = true;
    // 等待 fire-and-forget 初始化完成（ensureAlarm 调度一次 alarm）
    await waitFor(() => chromeMock.alarmCreates.length >= 1);
    await settle();
  }
}

// ===== listener 注册验证 =====

test('main registers all 5 Chrome listeners synchronously', async () => {
  await ensureMainImported();
  assert.equal(chromeMock.listeners.onMessage.length, 1, 'onMessage listener registered');
  assert.equal(chromeMock.listeners.onAlarm.length, 1, 'onAlarm listener registered');
  assert.equal(chromeMock.listeners.onInstalled.length, 1, 'onInstalled listener registered');
  assert.equal(chromeMock.listeners.onStartup.length, 1, 'onStartup listener registered');
  assert.equal(chromeMock.listeners.onStorageChanged.length, 1, 'onStorageChanged listener registered');
});

// ===== onAlarm 接线 =====

test('onAlarm with matching name triggers scheduler cycle', async () => {
  await ensureMainImported();
  const before = chromeMock.alarmCreates.length;

  // 模拟 alarm 事件
  chromeMock.listeners.onAlarm[0]({ name: ALARM_NAME, scheduledTime: Date.now() });

  // 等待 cycle 完成（safety + exact = 2 more alarm creates）
  await waitFor(() => chromeMock.alarmCreates.length >= before + 2);
  assert.ok(chromeMock.alarmCreates.length >= before + 2);

  // 空 watchlist → badge cleared
  assert.equal(chromeMock.badgeText, '');
  assert.equal(chromeMock.actionTitle, '股票提醒助手\n暂无自选股，点击添加');
});

test('onAlarm with non-matching name does not trigger cycle', async () => {
  await ensureMainImported();
  await settle();
  const before = chromeMock.alarmCreates.length;

  chromeMock.listeners.onAlarm[0]({ name: 'some-other-alarm', scheduledTime: Date.now() });

  // 等待若干微任务——确认无新 alarm create
  await settle();
  assert.equal(chromeMock.alarmCreates.length, before);
});

// ===== onStorageChanged 接线 =====

test('onStorageChanged with watchlist triggers coalesced cycle', async () => {
  await ensureMainImported();
  await settle();
  const before = chromeMock.alarmCreates.length;

  chromeMock.listeners.onStorageChanged[0](
    { watchlist: { oldValue: null, newValue: [] } },
    'local'
  );

  await waitFor(() => chromeMock.alarmCreates.length >= before + 2);
  assert.ok(chromeMock.alarmCreates.length >= before + 2);
});

test('onStorageChanged with groups triggers cycle', async () => {
  await ensureMainImported();
  await settle();
  const before = chromeMock.alarmCreates.length;

  chromeMock.listeners.onStorageChanged[0](
    { groups: { oldValue: null, newValue: [] } },
    'local'
  );

  await waitFor(() => chromeMock.alarmCreates.length >= before + 2);
  assert.ok(chromeMock.alarmCreates.length >= before + 2);
});

test('onStorageChanged with boardConfig triggers cycle', async () => {
  await ensureMainImported();
  await settle();
  const before = chromeMock.alarmCreates.length;

  chromeMock.listeners.onStorageChanged[0](
    { boardConfig: { oldValue: null, newValue: {} } },
    'local'
  );

  await waitFor(() => chromeMock.alarmCreates.length >= before + 2);
  assert.ok(chromeMock.alarmCreates.length >= before + 2);
});

test('onStorageChanged with quoteCache key does NOT trigger cycle', async () => {
  await ensureMainImported();
  await settle();
  const before = chromeMock.alarmCreates.length;

  chromeMock.listeners.onStorageChanged[0](
    { 'quoteCache:sh600519': { oldValue: null, newValue: {} } },
    'local'
  );

  // 等待若干微任务——确认无新 alarm create
  await settle();
  assert.equal(chromeMock.alarmCreates.length, before);
});

// ===== onInstalled / onStartup 接线 =====

test('onInstalled triggers scheduler cycle', async () => {
  await ensureMainImported();
  await settle();
  const before = chromeMock.alarmCreates.length;

  chromeMock.listeners.onInstalled[0]({ reason: 'install' });

  await waitFor(() => chromeMock.alarmCreates.length >= before + 2);
  assert.ok(chromeMock.alarmCreates.length >= before + 2);
});

test('onStartup triggers scheduler cycle', async () => {
  await ensureMainImported();
  await settle();
  const before = chromeMock.alarmCreates.length;

  chromeMock.listeners.onStartup[0]();

  await waitFor(() => chromeMock.alarmCreates.length >= before + 2);
  assert.ok(chromeMock.alarmCreates.length >= before + 2);
});
