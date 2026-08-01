import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

// 从 Router.createHandlers 抽取路由键，确保 Router 侧的动作集合稳定且完整。
// 该契约测试锁定 Bridge（Task 3）↔ Router 之间的动作一致性基线。
const mockService = { read: async () => {}, refresh: async () => {} };
const mockStorage = {
  loadAll: async () => {}, getBoardConfig: async () => {}, addStock: async () => {},
  removeStocksBatch: async () => {}, moveStocksToGroups: async () => {},
  togglePin: async () => {}, setManualOrder: async () => {},
  createGroup: async () => {}, renameGroup: async () => {},
  deleteGroup: async () => {}, reorderGroups: async () => {},
  saveBoardConfigForGroup: async () => {}
};

test('router exposes all 14 actions', () => {
  const Router = require('../../router.js');
  const handlers = Router.createHandlers(mockService, mockStorage);
  const actions = Object.keys(handlers).sort();
  const expected = [
    'quote:read', 'quote:refresh',
    'storage:addStock', 'storage:boardConfig', 'storage:createGroup',
    'storage:deleteGroup', 'storage:moveStocks', 'storage:read',
    'storage:removeStocks', 'storage:renameGroup', 'storage:reorderGroups',
    'storage:saveBoardConfig', 'storage:setManualOrder', 'storage:togglePin'
  ].sort();
  assert.deepEqual(actions, expected);
});

test('every route handler is a function', () => {
  const Router = require('../../router.js');
  const handlers = Router.createHandlers(mockService, mockStorage);
  for (const [action, handler] of Object.entries(handlers)) {
    assert.equal(typeof handler, 'function', `Handler for ${action} is not a function`);
  }
});
