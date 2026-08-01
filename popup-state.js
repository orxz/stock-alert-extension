// popup-state.js — Popup 视图状态管理
//
// 职责：持有当前视图状态快照（分组、自选股、行情、看板配置等），
// 提供 subscribe/notify/patch 三个基础能力，供 Render 订阅、Actions 修改。
// 所有持久化通过 Bridge RPC 与 background 通信，本模块不直接读 Storage。

const State = {
  current: {
    groups: [],
    watchlist: [],
    boardConfig: {},
    quoteSnapshot: {
      results: {},
      counts: { fresh: 0, cached: 0, missing: 0 },
      attemptedAt: null,
      succeededAt: null
    },
    quoteGeneration: 0,
    currentGroupId: 'g_all',
    viewMode: 'grid',
    sortField: 'manual',
    sortDirection: 'desc',
    columns: ['name', 'price', 'change', 'changePercent'],
    columnOrder: ['name', 'price', 'change', 'changePercent'],
    batchMode: false,
    selected: new Set(),
    searchKeyword: '',
    priceHidden: false,
    dragSrc: null,
    dragType: null
  },

  _listeners: new Set(),

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },

  notify() {
    this._listeners.forEach((fn) => fn(this.current));
  },

  patch(partial) {
    Object.assign(this.current, partial);
    this.notify();
  },

  // 启动时拉取一次：自选股 + 当前分组的看板配置 + 当前行情快照
  async init() {
    const versionElement = typeof document !== 'undefined' ? document.getElementById('brand-version') : null;
    if (versionElement) versionElement.textContent = chrome.runtime.getManifest().version;
    const data = await Bridge.send('storage:read', {});
    this.current.groups = data.groups;
    this.current.watchlist = data.watchlist;
    this.current.boardConfig = data.boardConfig;
    const cfg = await Bridge.send('storage:boardConfig', { groupId: this.current.currentGroupId });
    Object.assign(this.current, cfg);
    const codes = this.current.watchlist.map((stock) => stock.code);
    this.current.quoteSnapshot = await Bridge.send('quote:read', { codes });
    this.current.quoteGeneration = this.current.quoteSnapshot.generation || 0;
    this.notify();
  }
};

if (typeof module !== 'undefined') module.exports = State;
