// tests/unit/popup/raf-scheduler.test.ts
// 计划 Task 1 — 帧合并调度器：把连续的视口更新压成一帧一次。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRafScheduler } from '../../../src/popup/virtualization/raf-scheduler.js';

test('coalesces repeated schedule calls into one task', () => {
  let queued: FrameRequestCallback | null = null;
  let calls = 0;
  const scheduler = createRafScheduler(
    (cb) => { queued = cb; return 1; },
    () => { queued = null; },
    () => { calls += 1; }
  );
  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(calls, 0, 'nothing runs before the frame fires');
  queued?.(0);
  assert.equal(calls, 1, 'three schedules collapsed into one task');
});

test('schedules a fresh frame after the previous one ran', () => {
  let queued: FrameRequestCallback | null = null;
  let calls = 0;
  const scheduler = createRafScheduler(
    (cb) => { queued = cb; return 1; },
    () => { queued = null; },
    () => { calls += 1; }
  );
  scheduler.schedule();
  queued?.(0);
  scheduler.schedule();
  queued?.(0);
  assert.equal(calls, 2);
});

test('cancel prevents a pending task from running', () => {
  let queued: FrameRequestCallback | null = null;
  let cancelled = 0;
  let calls = 0;
  const scheduler = createRafScheduler(
    (cb) => { queued = cb; return 7; },
    (handle) => { cancelled = handle; queued = null; },
    () => { calls += 1; }
  );
  scheduler.schedule();
  scheduler.cancel();
  assert.equal(cancelled, 7, 'the real frame handle is cancelled');
  queued?.(0);
  assert.equal(calls, 0);
});

test('cancel is safe when nothing is pending', () => {
  let cancelCalls = 0;
  const scheduler = createRafScheduler(
    () => 1,
    () => { cancelCalls += 1; },
    () => {}
  );
  assert.doesNotThrow(() => scheduler.cancel());
  assert.equal(cancelCalls, 0);
});

test('a task that throws still clears the pending handle', () => {
  let queued: FrameRequestCallback | null = null;
  let calls = 0;
  const scheduler = createRafScheduler(
    (cb) => { queued = cb; return 1; },
    () => { queued = null; },
    () => {
      calls += 1;
      if (calls === 1) throw new Error('render blew up');
    }
  );
  scheduler.schedule();
  assert.throws(() => queued?.(0), /render blew up/);
  // 句柄没清干净的话调度器会永久卡死，后续滚动再也不会更新。
  scheduler.schedule();
  assert.doesNotThrow(() => queued?.(0));
  assert.equal(calls, 2, 'scheduler recovered after the failed frame');
});
