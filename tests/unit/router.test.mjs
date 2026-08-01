import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

function setupGlobals() {
  const handlers = {};
  global.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => { handlers.onMessage = fn; } }
    }
  };
  global.QuoteService = {
    create: () => ({
      read: async () => { throw new Error('override in test'); },
      refresh: async () => { throw new Error('override in test'); }
    })
  };
  global.Storage = {
    loadAll: async () => ({ groups: [], watchlist: [], boardConfig: {} }),
    getBoardConfig: async () => ({}),
    addStock: async () => ({ watchlist: [] }),
    removeStocksBatch: async () => ({ watchlist: [] }),
    moveStocksToGroups: async () => ({ watchlist: [] }),
    togglePin: async () => ({ watchlist: [] }),
    setManualOrder: async () => ({ watchlist: [] }),
    createGroup: async () => ({ groups: [] }),
    renameGroup: async () => ({ groups: [] }),
    deleteGroup: async () => ({ groups: [], watchlist: [] }),
    reorderGroups: async () => ({ groups: [] }),
    saveBoardConfigForGroup: async () => ({})
  };
  return handlers;
}

function reloadRouter() {
  delete require.cache[require.resolve('../../router.js')];
  return require('../../router.js');
}

test('unknown action returns error', async () => {
  const handlers = setupGlobals();
  require('../../router.js');
  let response = null;
  handlers.onMessage({ action: 'bogus', payload: {} }, {}, (r) => { response = r; });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'UNKNOWN_ACTION');
});

test('quote:read returns snapshot data', async () => {
  const handlers = setupGlobals();
  global.QuoteService = {
    create: () => ({
      read: async (codes) => ({ results: {}, counts: { fresh: 0, cached: 0, missing: 0 }, attemptedAt: 1, succeededAt: null, generation: 0 })
    })
  };
  global.Storage = { loadAll: async () => ({ groups: [], watchlist: [], boardConfig: {} }) };
  reloadRouter();
  let response = null;
  // Router uses async, so we need to wait for sendResponse
  const sendResponse = (r) => { response = r; };
  const result = handlers.onMessage({ action: 'quote:read', payload: { codes: ['sh600519'] } }, {}, sendResponse);
  assert.equal(result, true); // async response
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(response.ok, true);
  assert.ok(response.data.results);
});

test('storage:read returns groups watchlist boardConfig', async () => {
  const handlers = setupGlobals();
  global.Storage = {
    loadAll: async () => ({ groups: [{ groupId: 'g_all' }], watchlist: [{ code: 'sh600519' }], boardConfig: {} })
  };
  reloadRouter();
  let response = null;
  handlers.onMessage({ action: 'storage:read', payload: {} }, {}, (r) => { response = r; });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(response.ok, true);
  assert.equal(response.data.groups[0].groupId, 'g_all');
});

test('missing payload field returns validation error', async () => {
  const handlers = setupGlobals();
  reloadRouter();
  let response = null;
  handlers.onMessage({ action: 'quote:read', payload: {} }, {}, (r) => { response = r; });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'INVALID_PAYLOAD');
});

test('handler error propagates as INTERNAL error', async () => {
  const handlers = setupGlobals();
  global.Storage = {
    loadAll: async () => { throw new Error('disk corrupted'); }
  };
  reloadRouter();
  let response = null;
  handlers.onMessage({ action: 'storage:read', payload: {} }, {}, (r) => { response = r; });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'INTERNAL');
  assert.match(response.error.message, /disk corrupted/);
});

// 端到端分发：覆盖每条路由，校验参数透传与响应塑形
function recordingStorage(overrides = {}) {
  const calls = [];
  const base = {
    loadAll: async () => ({ groups: [{ groupId: 'g_all' }, { groupId: 'g1' }], watchlist: [{ code: 'sh600519' }], boardConfig: {} }),
    getBoardConfig: async (groupId) => { calls.push(['getBoardConfig', groupId]); return { sortField: 'price' }; },
    addStock: async (code, name, groupIds) => { calls.push(['addStock', code, name, groupIds]); },
    removeStocksBatch: async (codes, groupId) => { calls.push(['removeStocksBatch', codes, groupId]); },
    moveStocksToGroups: async (codes, fromGroup, toGroups) => { calls.push(['moveStocksToGroups', codes, fromGroup, toGroups]); },
    togglePin: async (groupId, code) => { calls.push(['togglePin', groupId, code]); },
    setManualOrder: async (groupId, orderMap) => { calls.push(['setManualOrder', groupId, orderMap]); },
    createGroup: async (name) => { calls.push(['createGroup', name]); },
    renameGroup: async (groupId, name) => { calls.push(['renameGroup', groupId, name]); },
    deleteGroup: async (groupId) => { calls.push(['deleteGroup', groupId]); },
    reorderGroups: async (ids) => { calls.push(['reorderGroups', ids]); },
    saveBoardConfigForGroup: async (groupId, patch) => { calls.push(['saveBoardConfigForGroup', groupId, patch]); },
    ...overrides
  };
  return { calls, store: base };
}

function dispatch(handlers, action, payload) {
  let response = null;
  handlers.onMessage({ action, payload }, {}, (r) => { response = r; });
  return new Promise((resolve) => {
    setTimeout(() => resolve(response), 30);
  });
}

test('quote:refresh forwards codes and force flag', async () => {
  const handlers = setupGlobals();
  const calls = [];
  global.QuoteService = {
    create: () => ({
      read: async () => { throw new Error('not used'); },
      refresh: async (codes, opts) => { calls.push([codes, opts]); return { results: {}, counts: { fresh: 0, cached: 0, missing: 0 }, attemptedAt: 1, succeededAt: null, generation: 0 }; }
    })
  };
  global.Storage = { loadAll: async () => ({ groups: [], watchlist: [], boardConfig: {} }) };
  reloadRouter();
  const response = await dispatch(handlers, 'quote:refresh', { codes: ['sh600519'], force: true });
  assert.equal(response.ok, true);
  assert.deepEqual(calls[0], [['sh600519'], { force: true }]);
});

test('storage:boardConfig forwards groupId', async () => {
  const handlers = setupGlobals();
  const { store } = recordingStorage();
  global.Storage = store;
  reloadRouter();
  const response = await dispatch(handlers, 'storage:boardConfig', { groupId: 'g1' });
  assert.equal(response.ok, true);
  assert.deepEqual(response.data, { sortField: 'price' });
});

test('storage:addStock forwards code/name/groupIds and returns watchlist', async () => {
  const handlers = setupGlobals();
  const { calls, store } = recordingStorage();
  global.Storage = store;
  reloadRouter();
  const response = await dispatch(handlers, 'storage:addStock', { code: 'sh600519', name: '贵州茅台', groupIds: ['g1'] });
  assert.equal(response.ok, true);
  assert.deepEqual(response.data.watchlist, [{ code: 'sh600519' }]);
  assert.deepEqual(calls[0], ['addStock', 'sh600519', '贵州茅台', ['g1']]);
});

test('storage:removeStocks forwards codes and groupId', async () => {
  const handlers = setupGlobals();
  const { calls, store } = recordingStorage();
  global.Storage = store;
  reloadRouter();
  const response = await dispatch(handlers, 'storage:removeStocks', { codes: ['sh600519'], groupId: 'g_all' });
  assert.equal(response.ok, true);
  assert.deepEqual(calls[0], ['removeStocksBatch', ['sh600519'], 'g_all']);
});

test('storage:moveStocks forwards codes/fromGroup/toGroups', async () => {
  const handlers = setupGlobals();
  const { calls, store } = recordingStorage();
  global.Storage = store;
  reloadRouter();
  const response = await dispatch(handlers, 'storage:moveStocks', { codes: ['sh600519'], fromGroup: 'g1', toGroups: ['g2'] });
  assert.equal(response.ok, true);
  assert.deepEqual(calls[0], ['moveStocksToGroups', ['sh600519'], 'g1', ['g2']]);
});

test('storage:togglePin forwards groupId and code', async () => {
  const handlers = setupGlobals();
  const { calls, store } = recordingStorage();
  global.Storage = store;
  reloadRouter();
  const response = await dispatch(handlers, 'storage:togglePin', { groupId: 'g1', code: 'sh600519' });
  assert.equal(response.ok, true);
  assert.deepEqual(calls[0], ['togglePin', 'g1', 'sh600519']);
});

test('storage:setManualOrder forwards groupId and orderMap', async () => {
  const handlers = setupGlobals();
  const { calls, store } = recordingStorage();
  global.Storage = store;
  reloadRouter();
  const response = await dispatch(handlers, 'storage:setManualOrder', { groupId: 'g1', orderMap: { sh600519: 0 } });
  assert.equal(response.ok, true);
  assert.deepEqual(calls[0], ['setManualOrder', 'g1', { sh600519: 0 }]);
});

test('storage:createGroup forwards name and returns groups', async () => {
  const handlers = setupGlobals();
  const { calls, store } = recordingStorage();
  global.Storage = store;
  reloadRouter();
  const response = await dispatch(handlers, 'storage:createGroup', { name: '白酒' });
  assert.equal(response.ok, true);
  assert.deepEqual(calls[0], ['createGroup', '白酒']);
  assert.deepEqual(response.data.groups, [{ groupId: 'g_all' }, { groupId: 'g1' }]);
});

test('storage:renameGroup forwards groupId and name', async () => {
  const handlers = setupGlobals();
  const { calls, store } = recordingStorage();
  global.Storage = store;
  reloadRouter();
  const response = await dispatch(handlers, 'storage:renameGroup', { groupId: 'g1', name: '白酒' });
  assert.equal(response.ok, true);
  assert.deepEqual(calls[0], ['renameGroup', 'g1', '白酒']);
});

test('storage:deleteGroup forwards groupId and returns groups+watchlist', async () => {
  const handlers = setupGlobals();
  const { calls, store } = recordingStorage();
  global.Storage = store;
  reloadRouter();
  const response = await dispatch(handlers, 'storage:deleteGroup', { groupId: 'g1' });
  assert.equal(response.ok, true);
  assert.deepEqual(calls[0], ['deleteGroup', 'g1']);
  assert.deepEqual(response.data, { groups: [{ groupId: 'g_all' }, { groupId: 'g1' }], watchlist: [{ code: 'sh600519' }] });
});

test('storage:reorderGroups forwards ids', async () => {
  const handlers = setupGlobals();
  const { calls, store } = recordingStorage();
  global.Storage = store;
  reloadRouter();
  const response = await dispatch(handlers, 'storage:reorderGroups', { ids: ['g_all', 'g1'] });
  assert.equal(response.ok, true);
  assert.deepEqual(calls[0], ['reorderGroups', ['g_all', 'g1']]);
});

test('storage:saveBoardConfig forwards groupId and patch and returns empty object', async () => {
  const handlers = setupGlobals();
  const { calls, store } = recordingStorage();
  global.Storage = store;
  reloadRouter();
  const response = await dispatch(handlers, 'storage:saveBoardConfig', { groupId: 'g1', patch: { sortField: 'price' } });
  assert.equal(response.ok, true);
  assert.deepEqual(calls[0], ['saveBoardConfigForGroup', 'g1', { sortField: 'price' }]);
  assert.deepEqual(response.data, {});
});

test('payload validators reject wrong types with INVALID_PAYLOAD', async () => {
  const handlers = setupGlobals();
  reloadRouter();
  const cases = [
    { action: 'storage:boardConfig', payload: { groupId: 5 } },
    { action: 'storage:addStock', payload: { code: '', groupIds: [] } },
    { action: 'storage:addStock', payload: { code: 'sh600519', groupIds: 'g1' } },
    { action: 'storage:removeStocks', payload: { codes: 'sh600519', groupId: 'g_all' } },
    { action: 'storage:moveStocks', payload: { codes: [], fromGroup: '', toGroups: [] } },
    { action: 'storage:moveStocks', payload: { codes: [], fromGroup: 'g1', toGroups: 'g2' } },
    { action: 'storage:togglePin', payload: { groupId: 'g1', code: 5 } },
    { action: 'storage:setManualOrder', payload: { groupId: 'g1', orderMap: null } },
    { action: 'storage:createGroup', payload: { name: '' } },
    { action: 'storage:renameGroup', payload: { groupId: 'g1', name: '' } },
    { action: 'storage:deleteGroup', payload: { groupId: 5 } },
    { action: 'storage:reorderGroups', payload: { ids: 'g_all' } },
    { action: 'storage:saveBoardConfig', payload: { groupId: 'g1', patch: null } }
  ];
  for (const { action, payload } of cases) {
    const response = await dispatch(handlers, action, payload);
    assert.equal(response.ok, false, `${action} ${JSON.stringify(payload)} should fail`);
    assert.equal(response.error.code, 'INVALID_PAYLOAD', `${action} ${JSON.stringify(payload)}`);
  }
});

test('handler without explicit payload defaults to empty object', async () => {
  const handlers = setupGlobals();
  reloadRouter();
  let response = null;
  handlers.onMessage({ action: 'storage:read' }, {}, (r) => { response = r; });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(response.ok, true);
});

test('Router.init injects configured service and storage over globals', async () => {
  const handlers = setupGlobals();
  const Router = reloadRouter();
  const calls = [];
  Router.init(
    { read: async (codes) => { calls.push(['injected-read', codes]); return { results: {}, counts: { fresh: 0, cached: 0, missing: 0 }, attemptedAt: 1, succeededAt: null, generation: 0 }; } },
    { loadAll: async () => { calls.push(['injected-loadAll']); return { groups: [], watchlist: [], boardConfig: {} }; } }
  );
  const response = await dispatch(handlers, 'quote:read', { codes: ['sh600519'] });
  assert.equal(response.ok, true);
  assert.deepEqual(calls, [['injected-read', ['sh600519']]]);
});

