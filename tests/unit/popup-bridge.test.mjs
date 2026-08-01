import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

function setupBridge(sendMessageImpl) {
  global.chrome = {
    runtime: { sendMessage: sendMessageImpl }
  };
  delete require.cache[require.resolve('../../popup-bridge.js')];
  return require('../../popup-bridge.js');
}

test('send returns data on success', async () => {
  const Bridge = setupBridge(async (msg, cb) => {
    cb({ ok: true, data: { hello: 'world' } });
  });
  const result = await Bridge.send('quote:read', { codes: [] });
  assert.deepEqual(result, { hello: 'world' });
});

test('send throws with error code on failure', async () => {
  const Bridge = setupBridge(async (msg, cb) => {
    cb({ ok: false, error: { code: 'DISK_FULL', message: 'storage full' } });
  });
  await assert.rejects(
    () => Bridge.send('storage:read', {}),
    (err) => err.code === 'DISK_FULL' && err.message === 'storage full'
  );
});

test('send throws on no response (SW not registered)', async () => {
  const Bridge = setupBridge(async (msg, cb) => {
    cb(undefined);
  });
  await assert.rejects(
    () => Bridge.send('quote:read', { codes: [] }),
    (err) => err.message === 'SW_NO_RESPONSE'
  );
});

test('send times out after SW_TIMEOUT_MS', async () => {
  const Bridge = setupBridge(async (msg, cb) => {
    // Never calls cb — simulates hung SW
  });
  Bridge.SW_TIMEOUT_MS = 50; // Speed up test
  await assert.rejects(
    () => Bridge.send('quote:read', { codes: [] }),
    (err) => /超时|timeout/i.test(err.message)
  );
});

test('ACTIONS list matches all 14 RPC actions', () => {
  const Bridge = setupBridge(async () => {});
  assert.ok(Array.isArray(Bridge.ACTIONS));
  assert.equal(Bridge.ACTIONS.length, 14);
});
