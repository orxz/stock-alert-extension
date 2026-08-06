// tests/unit/popup/rpc-client.test.ts
// Task 13 Step 1 — typed callback RPC Client 测试。
// 区分：成功 / lastError / 空响应 / protocol mismatch / requestId mismatch / 10s 超时(RpcUncertainError) / ok:false / malformed。
import assert from 'node:assert/strict';
import test from 'node:test';

import { CallbackRpcClient, RpcUncertainError } from '../../../src/popup/rpc-client.js';
import type { RpcClient, SendMessage } from '../../../src/popup/rpc-client.js';
import type { RpcRequest } from '../../../src/protocol/index.js';

// ===== chrome.runtime.lastError 模拟工具 =====

interface ChromeLike {
  runtime?: { lastError?: unknown };
}

function getChrome(): ChromeLike {
  const g = globalThis as unknown as { chrome?: ChromeLike };
  if (!g.chrome) g.chrome = {};
  return g.chrome;
}

function setLastError(value: unknown): void {
  const chrome = getChrome();
  if (!chrome.runtime) chrome.runtime = {};
  chrome.runtime.lastError = value;
}

function clearLastError(): void {
  const chrome = getChrome();
  if (chrome.runtime) delete chrome.runtime.lastError;
}

/** 捕获 sendMessage 的 (message, callback)，便于测试驱动响应。 */
interface CapturedSend {
  message: RpcRequest<string, unknown>;
  callback: (response?: unknown) => void;
}

function captureSend(): { sendMessage: SendMessage; captured: CapturedSend | null } {
  let captured: CapturedSend | null = null;
  const sendMessage = ((message: RpcRequest<string, unknown>, callback: (response?: unknown) => void) => {
    captured = { message, callback };
  }) as SendMessage;
  return { sendMessage, get captured() { return captured; } };
}

// ===== tests =====

test('resolves with data when response is ok:true', async () => {
  const { sendMessage, ...rest } = captureSend();
  const capturedRef: { c: CapturedSend | null } = { c: null };
  const sendFn = ((message: RpcRequest<string, unknown>, callback: (response?: unknown) => void) => {
    capturedRef.c = { message, callback };
  }) as SendMessage;
  const client: RpcClient = new CallbackRpcClient(sendFn);
  const promise = client.call('app:bootstrap', {});
  assert.ok(capturedRef.c, 'sendMessage 同步调用');
  capturedRef.c.callback({ protocol: 2, requestId: capturedRef.c.message.requestId, ok: true, data: { version: '2.0.0' } });
  const result = await promise;
  assert.deepEqual(result, { version: '2.0.0' });
});

test('rejects with non-uncertain error on chrome.runtime.lastError (connection failed)', async () => {
  const capturedRef: { c: CapturedSend | null } = { c: null };
  const sendFn = ((message: RpcRequest<string, unknown>, callback: (response?: unknown) => void) => {
    capturedRef.c = { message, callback };
  }) as SendMessage;
  const client = new CallbackRpcClient(sendFn);
  const promise = client.call('app:bootstrap', {});
  setLastError('The message port closed before a response was received.');
  capturedRef.c!.callback(undefined);
  clearLastError();
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(!(err instanceof RpcUncertainError), 'lastError 不是不确定错误');
    const e = err as Error & { code?: string; retryable?: boolean };
    assert.equal(e.code, 'CONNECTION_FAILED');
    assert.equal(e.retryable, false);
    return true;
  });
});

test('rejects with non-uncertain error on empty response (callback no args)', async () => {
  const capturedRef: { c: CapturedSend | null } = { c: null };
  const sendFn = ((message: RpcRequest<string, unknown>, callback: (response?: unknown) => void) => {
    capturedRef.c = { message, callback };
  }) as SendMessage;
  const client = new CallbackRpcClient(sendFn);
  const promise = client.call('app:bootstrap', {});
  clearLastError();
  capturedRef.c!.callback(undefined); // 空响应
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(!(err instanceof RpcUncertainError));
    const e = err as Error & { code?: string };
    assert.equal(e.code, 'EMPTY_RESPONSE');
    return true;
  });
});

test('rejects with PROTOCOL_MISMATCH when protocol !== 2', async () => {
  const capturedRef: { c: CapturedSend | null } = { c: null };
  const sendFn = ((message: RpcRequest<string, unknown>, callback: (response?: unknown) => void) => {
    capturedRef.c = { message, callback };
  }) as SendMessage;
  const client = new CallbackRpcClient(sendFn);
  const promise = client.call('app:bootstrap', {});
  clearLastError();
  capturedRef.c!.callback({ protocol: 1, requestId: capturedRef.c!.message.requestId, ok: true, data: {} });
  await assert.rejects(promise, (err: unknown) => {
    const e = err as Error & { code?: string };
    assert.equal(e.code, 'PROTOCOL_MISMATCH');
    assert.ok(!(err instanceof RpcUncertainError));
    return true;
  });
});

test('rejects with REQUEST_ID_MISMATCH when requestId differs', async () => {
  const capturedRef: { c: CapturedSend | null } = { c: null };
  const sendFn = ((message: RpcRequest<string, unknown>, callback: (response?: unknown) => void) => {
    capturedRef.c = { message, callback };
  }) as SendMessage;
  const client = new CallbackRpcClient(sendFn);
  const promise = client.call('app:bootstrap', {});
  clearLastError();
  capturedRef.c!.callback({ protocol: 2, requestId: 'some-other-id', ok: true, data: {} });
  await assert.rejects(promise, (err: unknown) => {
    const e = err as Error & { code?: string };
    assert.equal(e.code, 'REQUEST_ID_MISMATCH');
    assert.ok(!(err instanceof RpcUncertainError));
    return true;
  });
});

test('rejects with server error (code/message/retryable) when ok:false', async () => {
  const capturedRef: { c: CapturedSend | null } = { c: null };
  const sendFn = ((message: RpcRequest<string, unknown>, callback: (response?: unknown) => void) => {
    capturedRef.c = { message, callback };
  }) as SendMessage;
  const client = new CallbackRpcClient(sendFn);
  const promise = client.call('stock:add', {
    expectedRevision: 'sha256:r1' as never,
    code: 'sh600519',
    name: '茅台',
    groupIds: []
  } as never);
  clearLastError();
  capturedRef.c!.callback({
    protocol: 2,
    requestId: capturedRef.c!.message.requestId,
    ok: false,
    error: { code: 'VALIDATION_FAILED', message: '无效代码', retryable: false }
  });
  await assert.rejects(promise, (err: unknown) => {
    const e = err as Error & { code?: string; message?: string; retryable?: boolean };
    assert.equal(e.code, 'VALIDATION_FAILED');
    assert.equal(e.message, '无效代码');
    assert.equal(e.retryable, false);
    assert.ok(!(err instanceof RpcUncertainError));
    return true;
  });
});

test('rejects with MALFORMED_RESPONSE when ok field missing', async () => {
  const capturedRef: { c: CapturedSend | null } = { c: null };
  const sendFn = ((message: RpcRequest<string, unknown>, callback: (response?: unknown) => void) => {
    capturedRef.c = { message, callback };
  }) as SendMessage;
  const client = new CallbackRpcClient(sendFn);
  const promise = client.call('app:bootstrap', {});
  clearLastError();
  capturedRef.c!.callback({ protocol: 2, requestId: capturedRef.c!.message.requestId });
  await assert.rejects(promise, (err: unknown) => {
    const e = err as Error & { code?: string };
    assert.equal(e.code, 'MALFORMED_RESPONSE');
    return true;
  });
});

test('10s timeout rejects with RpcUncertainError (send succeeded, response lost)', async () => {
  const capturedRef: { c: CapturedSend | null } = { c: null };
  const sendFn = ((message: RpcRequest<string, unknown>, callback: (response?: unknown) => void) => {
    capturedRef.c = { message, callback }; // 不调用 callback，模拟响应丢失
  }) as SendMessage;
  const client = new CallbackRpcClient(sendFn);
  const promise = client.call('app:bootstrap', {}, { timeoutMs: 10 });
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof RpcUncertainError, '超时必须是 RpcUncertainError');
    assert.equal((err as RpcUncertainError).code, 'RPC_UNCERTAIN');
    return true;
  });
});

test('timeout does not reject if response arrives just in time', async () => {
  const capturedRef: { c: CapturedSend | null } = { c: null };
  const sendFn = ((message: RpcRequest<string, unknown>, callback: (response?: unknown) => void) => {
    capturedRef.c = { message, callback };
  }) as SendMessage;
  const client = new CallbackRpcClient(sendFn);
  const promise = client.call('app:bootstrap', {}, { timeoutMs: 1000 });
  clearLastError();
  capturedRef.c!.callback({ protocol: 2, requestId: capturedRef.c!.message.requestId, ok: true, data: 'ok' });
  const result = await promise;
  assert.equal(result, 'ok');
});

test('late response after timeout is ignored (no double-settle)', async () => {
  const capturedRef: { c: CapturedSend | null } = { c: null };
  const sendFn = ((message: RpcRequest<string, unknown>, callback: (response?: unknown) => void) => {
    capturedRef.c = { message, callback };
  }) as SendMessage;
  const client = new CallbackRpcClient(sendFn);
  const promise = client.call('app:bootstrap', {}, { timeoutMs: 10 });
  await assert.rejects(promise, RpcUncertainError);
  // 超时后再调用 callback 不应抛未捕获异常
  capturedRef.c!.callback({ protocol: 2, requestId: capturedRef.c!.message.requestId, ok: true, data: 'late' });
  // 让微任务排空
  await new Promise((r) => setTimeout(r, 0));
});

test('requestId is a unique non-empty string per call', async () => {
  const seen = new Set<string>();
  const sendFn = ((message: RpcRequest<string, unknown>, callback: (response?: unknown) => void) => {
    seen.add(message.requestId);
    callback({ protocol: 2, requestId: message.requestId, ok: true, data: null });
  }) as SendMessage;
  const client = new CallbackRpcClient(sendFn);
  await client.call('app:bootstrap', {});
  await client.call('app:bootstrap', {});
  assert.equal(seen.size, 2, '每次 call 生成唯一 requestId');
  for (const id of seen) assert.ok(typeof id === 'string' && id.length > 0);
});

test('request envelope has protocol=2, method, and payload', async () => {
  const capturedRef: { c: CapturedSend | null } = { c: null };
  const sendFn = ((message: RpcRequest<string, unknown>, callback: (response?: unknown) => void) => {
    capturedRef.c = { message, callback };
  }) as SendMessage;
  const client = new CallbackRpcClient(sendFn);
  const p = client.call('app:bootstrap', {} as never);
  const msg = capturedRef.c!.message;
  assert.equal(msg.protocol, 2);
  assert.equal(msg.method, 'app:bootstrap');
  assert.deepEqual(msg.payload, {});
  capturedRef.c!.callback({ protocol: 2, requestId: msg.requestId, ok: true, data: null });
  await p;
});
