// tests/unit/background/rpc-handlers.test.ts
// Task 10 — 穷尽式 RPC handler 表：13 个方法各映射到唯一 service 调用。
// satisfies { [M in RpcMethod]: RpcHandler<M> } 在编译期保证缺失/多余条目被 TS 拒绝。
// 此测试在运行时验证：handler 表键集 == 注册表键集，且每个方法分发到正确的 service 方法。
import assert from 'node:assert/strict';
import test from 'node:test';

import { handlers } from '../../../src/background/rpc-handlers.js';
import { rpcRegistry } from '../../../src/protocol/registry.js';
import type { RpcMethod } from '../../../src/protocol/registry.js';

const methods = Object.keys(rpcRegistry) as readonly RpcMethod[];

/** 每个方法的合法 payload（与 registry 校验器兼容）。 */
const validPayloads: Record<string, unknown> = {
  'app:bootstrap': {},
  'quote:refresh': { codes: ['sh600519'], force: false },
  'stock:search': { query: '茅台' },
  'stock:add': { expectedRevision: 'sha256:abc', code: 'sh600519', name: '贵州茅台', groupIds: ['g_all'] },
  'stock:remove': { expectedRevision: 'sha256:abc', codes: ['sh600519'], groupId: 'g_all' },
  'stock:move': { expectedRevision: 'sha256:abc', codes: ['sh600519'], fromGroupId: 'g_all', targetGroupIds: ['g_1'] },
  'stock:setPinned': { expectedRevision: 'sha256:abc', groupId: 'g_all', code: 'sh600519', pinned: true, orderedCodes: ['sh600519'] },
  'stock:setOrder': { expectedRevision: 'sha256:abc', groupId: 'g_all', orderedCodes: ['sh600519'] },
  'group:create': { expectedRevision: 'sha256:abc', groupId: 'g_1', name: '科技' },
  'group:rename': { expectedRevision: 'sha256:abc', groupId: 'g_1', name: '消费' },
  'group:delete': { expectedRevision: 'sha256:abc', groupId: 'g_1' },
  'group:setOrder': { expectedRevision: 'sha256:abc', orderedGroupIds: ['g_all', 'g_1'] },
  'preferences:patch': { expectedRevision: 'sha256:abc', groupId: 'g_all', patch: { viewMode: 'grid' } }
};

/** 每个方法应分发到的 service 方法名。 */
const expectedTarget: Record<string, string> = {
  'app:bootstrap': 'bootstrap.execute',
  'quote:refresh': 'quotes.refresh',
  'stock:search': 'search.search',
  'stock:add': 'portfolio.addStock',
  'stock:remove': 'portfolio.removeStocks',
  'stock:move': 'portfolio.moveStocks',
  'stock:setPinned': 'portfolio.setPinned',
  'stock:setOrder': 'portfolio.setOrder',
  'group:create': 'portfolio.createGroup',
  'group:rename': 'portfolio.renameGroup',
  'group:delete': 'portfolio.deleteGroup',
  'group:setOrder': 'portfolio.setGroupOrder',
  'preferences:patch': 'portfolio.patchPreferences'
};

/** 构造记录调用的 mock services。 */
function recordingServices(): { services: Record<string, unknown>; called: string[] } {
  const called: string[] = [];
  const rec = (name: string) => (..._args: unknown[]) => {
    called.push(name);
    return Promise.resolve(null);
  };
  const services = {
    bootstrap: { execute: rec('bootstrap.execute') },
    quotes: { refresh: rec('quotes.refresh'), read: rec('quotes.read') },
    search: { search: rec('search.search') },
    portfolio: {
      addStock: rec('portfolio.addStock'),
      removeStocks: rec('portfolio.removeStocks'),
      moveStocks: rec('portfolio.moveStocks'),
      setPinned: rec('portfolio.setPinned'),
      setOrder: rec('portfolio.setOrder'),
      createGroup: rec('portfolio.createGroup'),
      renameGroup: rec('portfolio.renameGroup'),
      deleteGroup: rec('portfolio.deleteGroup'),
      setGroupOrder: rec('portfolio.setGroupOrder'),
      patchPreferences: rec('portfolio.patchPreferences')
    }
  };
  return { services: services as unknown as Record<string, unknown>, called };
}

test('handler table keys match the registry exactly', () => {
  assert.deepEqual(Object.keys(handlers).sort(), [...methods].sort());
});

test('handler table has exactly 13 entries', () => {
  assert.equal(Object.keys(handlers).length, 13);
});

// 逐方法验证：handlers[method] 调用对应的 service 方法。
for (const method of methods) {
  test(`handlers['${method}'] dispatches to ${expectedTarget[method]}`, async () => {
    const { services, called } = recordingServices();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (handlers as Record<string, (p: unknown, s: unknown) => Promise<unknown>>)[method](
      validPayloads[method],
      services
    );
    assert.deepEqual(called, [expectedTarget[method]]);
  });
}

test('quote:refresh forwards codes and force flag to quotes.refresh', async () => {
  const received: { codes?: unknown; force?: unknown } = {};
  const services = {
    bootstrap: { execute: () => Promise.resolve(null) },
    quotes: {
      refresh: (codes: unknown, options: { force?: boolean }) => {
        received.codes = codes;
        received.force = options?.force;
        return Promise.resolve(null);
      },
      read: () => Promise.resolve(null)
    },
    search: { search: () => Promise.resolve(null) },
    portfolio: {}
  };
  await (handlers as Record<string, (p: unknown, s: unknown) => Promise<unknown>>)['quote:refresh'](
    { codes: ['sh600519', 'sz000001'], force: true },
    services
  );
  assert.deepEqual(received.codes, ['sh600519', 'sz000001']);
  assert.equal(received.force, true);
});

test('stock:search forwards query to search.search', async () => {
  const received: { query?: unknown } = {};
  const services = {
    bootstrap: { execute: () => Promise.resolve(null) },
    quotes: { refresh: () => Promise.resolve(null), read: () => Promise.resolve(null) },
    search: { search: (q: unknown) => { received.query = q; return Promise.resolve([]); } },
    portfolio: {}
  };
  await (handlers as Record<string, (p: unknown, s: unknown) => Promise<unknown>>)['stock:search'](
    { query: '茅台' },
    services
  );
  assert.equal(received.query, '茅台');
});
