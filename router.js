// router.js — RPC 路由器：接收 chrome.runtime.onMessage，分发到 QuoteService / Storage
//
// 设计要点：
// - 模块加载时若检测到 chrome.runtime.onMessage，自动注册 handleMessage 监听器；
//   service / storage 延迟到首条消息到达时再解析，便于测试用 globalThis 注入 mock，
//   也便于 background.js 通过 Router.init(configuredService, Storage) 注入已配置的实例。
// - 通过 init() 注入的实例优先于全局 QuoteService.create() / Storage，避免在
//   background.js 中以无参 QuoteService.create() 创建出不可用的服务。

const Router = (() => {
  let routes = null;       // 延迟构建的路由表
  let injected = null;     // init() 注入的 { service, storage }
  let registered = false;  // 防止重复注册监听器

  function validationError(field, expectation) {
    const err = new Error(`Expected ${field} to be ${expectation}`);
    err.code = 'INVALID_PAYLOAD';
    return err;
  }

  function assertArray(value, field) {
    if (!Array.isArray(value)) throw validationError(field, 'an array');
  }

  function assertString(value, field) {
    if (typeof value !== 'string' || !value) throw validationError(field, 'a non-empty string');
  }

  function assertObject(value, field) {
    if (typeof value !== 'object' || value === null) throw validationError(field, 'an object');
  }

  function resolveService() {
    if (injected?.service) return injected.service;
    if (typeof QuoteService !== 'undefined' && QuoteService) return QuoteService.create();
    return null;
  }

  function resolveStorage() {
    if (injected?.storage) return injected.storage;
    if (typeof Storage !== 'undefined' && Storage) return Storage;
    return null;
  }

  function getRoutes() {
    if (!routes) routes = createHandlers(resolveService(), resolveStorage());
    return routes;
  }

  function createHandlers(service, storage) {
    return {
      'quote:read': async (payload) => {
        assertArray(payload.codes, 'codes');
        return service.read(payload.codes);
      },
      'quote:refresh': async (payload) => {
        assertArray(payload.codes, 'codes');
        return service.refresh(payload.codes, { force: payload.force || false });
      },
      'storage:read': async () => {
        return storage.loadAll();
      },
      'storage:boardConfig': async (payload) => {
        assertString(payload.groupId, 'groupId');
        return storage.getBoardConfig(payload.groupId);
      },
      'storage:addStock': async (payload) => {
        assertString(payload.code, 'code');
        assertArray(payload.groupIds, 'groupIds');
        await storage.addStock(payload.code, payload.name || '', payload.groupIds);
        const data = await storage.loadAll();
        return { watchlist: data.watchlist };
      },
      'storage:removeStocks': async (payload) => {
        assertArray(payload.codes, 'codes');
        assertString(payload.groupId, 'groupId');
        await storage.removeStocksBatch(payload.codes, payload.groupId);
        const data = await storage.loadAll();
        return { watchlist: data.watchlist };
      },
      'storage:moveStocks': async (payload) => {
        assertArray(payload.codes, 'codes');
        assertString(payload.fromGroup, 'fromGroup');
        assertArray(payload.toGroups, 'toGroups');
        await storage.moveStocksToGroups(payload.codes, payload.fromGroup, payload.toGroups);
        const data = await storage.loadAll();
        return { watchlist: data.watchlist };
      },
      'storage:togglePin': async (payload) => {
        assertString(payload.groupId, 'groupId');
        assertString(payload.code, 'code');
        await storage.togglePin(payload.groupId, payload.code);
        const data = await storage.loadAll();
        return { watchlist: data.watchlist };
      },
      'storage:setManualOrder': async (payload) => {
        assertString(payload.groupId, 'groupId');
        assertObject(payload.orderMap, 'orderMap');
        await storage.setManualOrder(payload.groupId, payload.orderMap);
        const data = await storage.loadAll();
        return { watchlist: data.watchlist };
      },
      'storage:createGroup': async (payload) => {
        assertString(payload.name, 'name');
        await storage.createGroup(payload.name);
        const data = await storage.loadAll();
        return { groups: data.groups };
      },
      'storage:renameGroup': async (payload) => {
        assertString(payload.groupId, 'groupId');
        assertString(payload.name, 'name');
        await storage.renameGroup(payload.groupId, payload.name);
        const data = await storage.loadAll();
        return { groups: data.groups };
      },
      'storage:deleteGroup': async (payload) => {
        assertString(payload.groupId, 'groupId');
        await storage.deleteGroup(payload.groupId);
        const data = await storage.loadAll();
        return { groups: data.groups, watchlist: data.watchlist };
      },
      'storage:reorderGroups': async (payload) => {
        assertArray(payload.ids, 'ids');
        await storage.reorderGroups(payload.ids);
        const data = await storage.loadAll();
        return { groups: data.groups };
      },
      'storage:saveBoardConfig': async (payload) => {
        assertString(payload.groupId, 'groupId');
        assertObject(payload.patch, 'patch');
        await storage.saveBoardConfigForGroup(payload.groupId, payload.patch);
        return {};
      }
    };
  }

  // chrome.runtime.onMessage 监听器：查表 → 执行异步 handler → 回包。
  // 未知 action 同步回包并返回 false；命中路由则返回 true 以保持消息通道开启直到 sendResponse 被调用。
  function handleMessage(request, sender, sendResponse) {
    const handler = getRoutes()[request.action];
    if (!handler) {
      sendResponse({ ok: false, error: { code: 'UNKNOWN_ACTION', message: `Unknown action: ${request.action}` } });
      return false;
    }
    handler(request.payload || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: { code: err.code || 'INTERNAL', message: err.message } }));
    return true;
  }

  function init(service, storage) {
    injected = { service, storage };
    routes = null; // 失效缓存，使后续消息使用注入的依赖
    if (!registered && typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleMessage);
      registered = true;
    }
  }

  // 浏览器/Service Worker 环境：模块加载即注册监听器；service / storage 由首条消息延迟解析。
  // 测试环境（node:test）下，globalThis.chrome / QuoteService / Storage 由测试用例注入。
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(handleMessage);
    registered = true;
  }

  return { createHandlers, init, handleMessage, get routes() { return routes; } };
})();

if (typeof globalThis !== 'undefined') globalThis.Router = Router;

if (typeof module !== 'undefined') module.exports = Router;
