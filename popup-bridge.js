// popup-bridge.js — RPC 客户端：封装 chrome.runtime.sendMessage 为 Promise
//
// 设计要点：
// - send(action, payload) 返回 Promise<data>，统一处理 SW 未响应、超时、错误回包。
// - SW_TIMEOUT_MS 默认 10s，覆盖行情刷新的最坏耗时；测试可覆写以加速。
// - ACTIONS 列出全部 14 个 RPC action，与 router.js 的路由键一一对齐，
//   由 tests/unit/protocol-contract.test.mjs 锁定一致性。

const Bridge = (() => {
  // 内部可变状态：测试可通过 Bridge.SW_TIMEOUT_MS = N 覆写以加速超时用例。
  const state = { SW_TIMEOUT_MS: 10000 };

  const ACTIONS = [
    'quote:read', 'quote:refresh',
    'storage:read', 'storage:boardConfig',
    'storage:addStock', 'storage:removeStocks', 'storage:moveStocks',
    'storage:togglePin', 'storage:setManualOrder',
    'storage:createGroup', 'storage:renameGroup', 'storage:deleteGroup',
    'storage:reorderGroups', 'storage:saveBoardConfig'
  ];

  function send(action, payload) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('后台服务响应超时，请重试'));
        }
      }, state.SW_TIMEOUT_MS);

      chrome.runtime.sendMessage({ action, payload }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (!response) {
          reject(new Error('SW_NO_RESPONSE'));
          return;
        }
        if (!response.ok) {
          const err = new Error(response.error.message);
          err.code = response.error.code;
          reject(err);
          return;
        }
        resolve(response.data);
      });
    });
  }

  return {
    send,
    ACTIONS,
    get SW_TIMEOUT_MS() { return state.SW_TIMEOUT_MS; },
    set SW_TIMEOUT_MS(v) { state.SW_TIMEOUT_MS = v; }
  };
})();

if (typeof globalThis !== 'undefined') globalThis.Bridge = Bridge;

if (typeof module !== 'undefined') module.exports = Bridge;
