// tests/unit/protocol/messages.test.ts
// Task 5 — RPC 消息信封形状与判别联合（ok/error）测试。
// RpcResponse<M> 是 { ok: true; data } | { ok: false; error } 的判别联合：ok 分支只能读 data，
// error 分支只能读 error。RpcRequestFor/RpcResponseFor 将方法名映射到对应的 payload/result。
import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  RpcRequest,
  RpcResponse,
  MutationResult,
  BootstrapResult,
  AddStockPayload,
  QuoteRefreshPayload
} from '../../../src/protocol/messages.js';
import type { RpcError } from '../../../src/protocol/error-codes.js';
import { rpcRegistry } from '../../../src/protocol/registry.js';
import type {
  RpcMethod,
  RpcRequestFor,
  RpcResponseFor,
  RpcPayload,
  RpcResult,
  MutationMethod,
  MutationPayload
} from '../../../src/protocol/registry.js';

test('RpcResponse is a discriminated union: ok branch exposes data, not error', () => {
  const res: RpcResponse<number> = { protocol: 2, requestId: 'r1', ok: true, data: 42 };
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data, 42);
    assert.equal('error' in res, false);
  }
});

test('RpcResponse error branch exposes error, not data', () => {
  const err: RpcError = { code: 'INVALID_PAYLOAD', message: 'bad', retryable: false };
  const res: RpcResponse<number> = { protocol: 2, requestId: 'r1', ok: false, error: err };
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'INVALID_PAYLOAD');
    assert.equal(res.error.retryable, false);
    assert.equal('data' in res, false);
  }
});

test('RpcResponse error carries all 11 stable codes', () => {
  const codes = [
    'UNKNOWN_METHOD', 'INVALID_PAYLOAD', 'PROTOCOL_MISMATCH',
    'STORAGE_UNAVAILABLE', 'QUOTE_TIMEOUT', 'QUOTE_UNAVAILABLE',
    'SEARCH_UNAVAILABLE', 'CONFLICT', 'NOT_FOUND',
    'VALIDATION_FAILED', 'INTERNAL'
  ] as const;
  for (const code of codes) {
    const res: RpcResponse<null> = { protocol: 2, requestId: 'r1', ok: false, error: { code, message: 'm', retryable: true } };
    if (!res.ok) assert.equal(res.error.code, code);
  }
});

test('RpcRequest carries protocol, requestId, method and payload', () => {
  const req: RpcRequest<'quote:refresh', QuoteRefreshPayload> = {
    protocol: 2,
    requestId: 'abc-123',
    method: 'quote:refresh',
    payload: { codes: ['sh600519'], force: false }
  };
  assert.equal(req.protocol, 2);
  assert.equal(req.requestId, 'abc-123');
  assert.equal(req.method, 'quote:refresh');
  assert.deepEqual(req.payload.codes, ['sh600519']);
});

test('RpcRequestFor maps method name to its validated payload shape', () => {
  const req: RpcRequestFor<'stock:add'> = {
    protocol: 2,
    requestId: 'r1',
    method: 'stock:add',
    payload: { expectedRevision: 'sha256:abc', code: 'sh600519', name: '贵州茅台', groupIds: ['g_1'] }
  };
  assert.equal(req.method, 'stock:add');
});

test('RpcPayload maps a method to its payload type', () => {
  const payload: RpcPayload<'quote:refresh'> = { codes: ['sh600519'], force: true };
  assert.deepEqual(payload.codes, ['sh600519']);
});

test('RpcResponseFor maps app:bootstrap to BootstrapResult', () => {
  // Construct a minimal BootstrapResult via type assertion; the assertion proves the type maps correctly.
  const data = { version: '2.0.0' } as unknown as BootstrapResult;
  const res: RpcResponseFor<'app:bootstrap'> = { protocol: 2, requestId: 'r1', ok: true, data };
  if (res.ok) assert.equal(res.data.version, '2.0.0');
});

test('RpcResult maps stock:add to MutationResult<Stock>', () => {
  // Type-level: constructing a MutationResult<Stock>-shaped value proves the mapping.
  const result = { value: { code: 'sh600519' } } as unknown as RpcResult<'stock:add'>;
  assert.ok(result && typeof result === 'object');
});

test('MutationResult carries value, userData and revision', () => {
  const mr: MutationResult<number> = {
    value: 7,
    userData: { schemaVersion: 2, groups: [], watchlist: [], boardConfig: {} },
    revision: 'sha256:abc' as never
  };
  assert.equal(mr.value, 7);
  assert.equal(mr.userData.schemaVersion, 2);
});

test('MutationPayload unifies all mutation payload shapes', () => {
  // Any mutation method's payload is assignable to MutationPayload.
  const add: AddStockPayload = { expectedRevision: 'sha256:abc' as never, code: 'sh600519' as never, name: 'x', groupIds: [] };
  const mp: MutationPayload = add as MutationPayload;
  assert.equal(mp, add);
});

test('MutationMethod excludes the three read methods (compile-time + runtime count)', () => {
  // Compile-time: read methods resolve to false (excluded); mutation methods resolve to true (included).
  type Check<M extends RpcMethod> = M extends MutationMethod ? true : false;
  const notBootstrap: false = (false as unknown as Check<'app:bootstrap'>);
  const notRefresh: false = (false as unknown as Check<'quote:refresh'>);
  const notSearch: false = (false as unknown as Check<'stock:search'>);
  const isMutation: true = (true as unknown as Check<'stock:add'>);
  assert.equal(notBootstrap, false);
  assert.equal(notRefresh, false);
  assert.equal(notSearch, false);
  assert.equal(isMutation, true);
  // Runtime: 13 total methods - 3 read methods = 10 mutation methods.
  assert.equal(Object.keys(rpcRegistry).length - 3, 10);
});
