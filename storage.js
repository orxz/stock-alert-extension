// storage.js — 本地存储读写 + 数据迁移（chrome.storage.local）
// 对应 PRD 3.2 / 3.3.2 / 3.3.3

const DEFAULT_GROUP_ID = 'g_all';
const DEFAULT_GROUP_NAME = '全部';
const MAX_GROUPS = 20;

const Storage = {
  // 读取全部数据
  async loadAll() {
    const data = await chrome.storage.local.get(['groups', 'watchlist', 'boardConfig', 'watchlist_legacy']);
    // 数据迁移：旧版扁平 watchlist → 分组结构
    if ((!data.groups || !data.watchlist) && data.watchlist_legacy) {
      return this._migrate(data.watchlist_legacy);
    }
    if (!data.groups) data.groups = [];
    if (!data.watchlist) data.watchlist = [];
    if (!data.boardConfig) data.boardConfig = {};
    // 确保默认"全部"分组存在
    if (!data.groups.find(g => g.groupId === DEFAULT_GROUP_ID)) {
      data.groups.unshift({ groupId: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, order: 0, isDefault: true, createdAt: Date.now(), updatedAt: Date.now() });
    }
    return data;
  },

  // 一次性迁移：旧版扁平列表 → 新版分组结构
  async _migrate(legacyList) {
    const now = Date.now();
    const groups = [{ groupId: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, order: 0, isDefault: true, createdAt: now, updatedAt: now }];
    const watchlist = (legacyList || []).map((code, i) => {
      const item = typeof code === 'string' ? { code } : code;
      return {
        code: item.code,
        name: item.name || item.code,
        groupIds: [DEFAULT_GROUP_ID],
        manualOrder: {},
        pinned: {},
        addedAt: item.addedAt || (now - i * 1000)
      };
    });
    const boardConfig = {};
    await chrome.storage.local.set({ groups, watchlist, boardConfig, watchlist_legacy: legacyList });
    return { groups, watchlist, boardConfig };
  },

  async saveGroups(groups) {
    await chrome.storage.local.set({ groups });
  },
  async saveWatchlist(watchlist) {
    await chrome.storage.local.set({ watchlist });
  },
  async saveBoardConfig(boardConfig) {
    await chrome.storage.local.set({ boardConfig });
  },

  // 分组操作
  async createGroup(name) {
    const { groups } = await this.loadAll();
    if (groups.length >= MAX_GROUPS) throw new Error('分组已达上限（20），请先删除无用分组');
    if (groups.some(g => g.name === name)) throw new Error('分组名已存在，请更换');
    const g = { groupId: 'g_' + Date.now(), name, order: groups.length, isDefault: false, createdAt: Date.now(), updatedAt: Date.now() };
    groups.push(g);
    await this.saveGroups(groups);
    return g;
  },

  async renameGroup(groupId, name) {
    const { groups } = await this.loadAll();
    if (groups.some(g => g.groupId !== groupId && g.name === name)) throw new Error('分组名已存在，请更换');
    const g = groups.find(x => x.groupId === groupId);
    if (g) { g.name = name; g.updatedAt = Date.now(); }
    await this.saveGroups(groups);
  },

  async deleteGroup(groupId) {
    if (groupId === DEFAULT_GROUP_ID) throw new Error('默认分组不可删除');
    const { groups, watchlist, boardConfig } = await this.loadAll();
    const newGroups = groups.filter(g => g.groupId !== groupId);
    // 组内股票移回"全部"（若同时属于其他分组则保留）
    watchlist.forEach(s => {
      if (s.groupIds.includes(groupId)) {
        s.groupIds = s.groupIds.filter(id => id !== groupId);
        if (!s.groupIds.includes(DEFAULT_GROUP_ID)) s.groupIds.push(DEFAULT_GROUP_ID);
      }
      delete s.manualOrder[groupId];
      delete s.pinned[groupId];
    });
    delete boardConfig[groupId];
    // 一次性保存全部变更，避免三次独立写入
    await chrome.storage.local.set({ groups: newGroups, watchlist, boardConfig });
  },

  async reorderGroups(newOrderIds) {
    const { groups } = await this.loadAll();
    const map = new Map(groups.map(g => [g.groupId, g]));
    // "全部"始终首位，无论 newOrderIds 中位置如何
    const ordered = [];
    const defaultG = map.get(DEFAULT_GROUP_ID);
    if (defaultG) { defaultG.order = 0; ordered.push(defaultG); }
    // 按用户拖拽顺序追加非默认分组
    newOrderIds.forEach(id => {
      if (id !== DEFAULT_GROUP_ID && map.has(id)) {
        const g = map.get(id);
        g.order = ordered.length;
        ordered.push(g);
      }
    });
    // 兜底：未在 newOrderIds 中的追加
    groups.forEach(g => {
      if (!ordered.includes(g)) { g.order = ordered.length; ordered.push(g); }
    });
    await this.saveGroups(ordered);
  },

  // 自选股操作
  async addStock(code, name, groupIds) {
    const { watchlist } = await this.loadAll();
    let stock = watchlist.find(s => s.code === code);
    if (stock) {
      groupIds.forEach(id => { if (!stock.groupIds.includes(id)) stock.groupIds.push(id); });
    } else {
      stock = { code, name: name || code, groupIds: groupIds.length ? groupIds : [DEFAULT_GROUP_ID], manualOrder: {}, pinned: {}, addedAt: Date.now() };
      watchlist.push(stock);
    }
    await this.saveWatchlist(watchlist);
    return stock;
  },

  async removeStock(code, groupId) {
    const { watchlist } = await this.loadAll();
    const stock = watchlist.find(s => s.code === code);
    if (!stock) return;
    if (groupId && groupId !== DEFAULT_GROUP_ID) {
      // 从指定分组移除（非默认分组）
      stock.groupIds = stock.groupIds.filter(id => id !== groupId);
      if (stock.groupIds.length === 0) stock.groupIds.push(DEFAULT_GROUP_ID);
      delete stock.manualOrder[groupId];
      delete stock.pinned[groupId];
    } else {
      // 从"全部"移除 = 彻底删除该自选股
      const i = watchlist.findIndex(s => s.code === code);
      if (i >= 0) watchlist.splice(i, 1);
    }
    await this.saveWatchlist(watchlist);
  },

  // 批量移除股票（一次读写，避免逐条 await 的性能问题）
  async removeStocksBatch(codes, groupId) {
    const { watchlist } = await this.loadAll();
    const codeSet = new Set(codes);
    if (groupId && groupId !== DEFAULT_GROUP_ID) {
      // 从指定分组批量移除
      watchlist.forEach(s => {
        if (codeSet.has(s.code)) {
          s.groupIds = s.groupIds.filter(id => id !== groupId);
          if (s.groupIds.length === 0) s.groupIds.push(DEFAULT_GROUP_ID);
          delete s.manualOrder[groupId];
          delete s.pinned[groupId];
        }
      });
    } else {
      // 从"全部"批量彻底删除
      for (let i = watchlist.length - 1; i >= 0; i--) {
        if (codeSet.has(watchlist[i].code)) watchlist.splice(i, 1);
      }
    }
    await this.saveWatchlist(watchlist);
  },

  async moveStocksToGroups(codes, fromGroupId, targetGroupIds) {
    const { watchlist } = await this.loadAll();
    codes.forEach(code => {
      const stock = watchlist.find(s => s.code === code);
      if (!stock) return;
      // 从源分组移除（非默认分组）
      if (fromGroupId && fromGroupId !== DEFAULT_GROUP_ID) {
        stock.groupIds = stock.groupIds.filter(id => id !== fromGroupId);
        delete stock.manualOrder[fromGroupId];
        delete stock.pinned[fromGroupId];
      }
      // 添加到目标分组
      targetGroupIds.forEach(id => { if (!stock.groupIds.includes(id)) stock.groupIds.push(id); });
      // 确保至少在"全部"中
      if (stock.groupIds.length === 0) stock.groupIds.push(DEFAULT_GROUP_ID);
    });
    await this.saveWatchlist(watchlist);
  },

  async setManualOrder(groupId, orderedCodes) {
    const { watchlist } = await this.loadAll();
    orderedCodes.forEach((code, i) => {
      const stock = watchlist.find(s => s.code === code);
      if (stock) stock.manualOrder[groupId] = i;
    });
    await this.saveWatchlist(watchlist);
  },

  async togglePin(groupId, code) {
    const { watchlist } = await this.loadAll();
    const stock = watchlist.find(s => s.code === code);
    if (!stock) return;
    // 取消置顶时删除 key 而非置 false，避免数据残留膨胀
    if (stock.pinned[groupId]) {
      delete stock.pinned[groupId];
    } else {
      stock.pinned[groupId] = true;
    }
    await this.saveWatchlist(watchlist);
  },

  // 看板配置
  async getBoardConfig(groupId) {
    const { boardConfig } = await this.loadAll();
    return boardConfig[groupId] || { viewMode: 'grid', sortField: 'manual', sortDirection: 'desc', columns: ['name', 'price', 'change', 'changePercent'], columnOrder: ['name', 'price', 'change', 'changePercent'] };
  },

  async saveBoardConfigForGroup(groupId, cfg) {
    const { boardConfig } = await this.loadAll();
    boardConfig[groupId] = { ...boardConfig[groupId], ...cfg };
    await this.saveBoardConfig(boardConfig);
  }
};
