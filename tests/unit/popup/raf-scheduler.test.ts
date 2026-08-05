import assert from 'node:assert/strict';
import test from 'node:test';
import { createRafScheduler } from '../../../src/popup/virtualization/raf-scheduler.js';

test('coalesces repeated schedule calls into one task', () => {
  let queued: FrameRequestCallback | null = null;
  let calls = 0;
  const scheduler = createRafScheduler(
    (callback) => { queued = callback; return 1; },
    () => { queued = null; },
    () => { calls += 1; }
  );

  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();

  assert.equal(calls, 0);
  queued?.(0);
  assert.equal(calls, 1);
});

test('cancels a queued frame and allows a later schedule', () => {
  let queued: FrameRequestCallback | null = null;
  let cancelledHandle: number | null = null;
  let calls = 0;
  const scheduler = createRafScheduler(
    (callback) => { queued = callback; return 7; },
    (handle) => { cancelledHandle = handle; },
    () => { calls += 1; }
  );

  scheduler.schedule();
  scheduler.cancel();

  assert.equal(cancelledHandle, 7);
  assert.equal(calls, 0);

  scheduler.schedule();
  assert.equal(queued !== null, true);
});
