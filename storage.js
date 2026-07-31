// storage.js — 本地存储读写 + 数据迁移（chrome.storage.local）
// 对应 PRD 3.2 / 3.3.2 / 3.3.3
// schema v2：watchlist[].groupIds 只保存自定义分组 ID，「全部」(g_all) 为计算视图

/**
 * @typedef {{ groupId: string, name: string, order: number, isDefault: boolean, createdAt?: number, updatedAt?: number }} Group
 * @typedef {{ code: string, name: string, groupIds: string[], manualOrder: Record<string, number>, pinned: Record<string, boolean>, addedAt: number }} Stock
 * @typedef {{ viewMode?: string, sortField?: string, sortDirection?: string, columns?: string[], columnOrder?: string[] }} BoardConfig
 * @typedef {{ get(keys?: string|string[]|null): Promise<Record<string, any>>, set(patch: Record<string, any>): Promise<void>, remove(keys: string|string[]): Promise<void> }} StorageArea
 */

const DEFAULT_GROUP_ID = 'g_all';
const DEFAULT_GROUP_NAME = '全部';
const MAX_GROUPS = 20;
const SCHEMA_VERSION = 2;
const MIGRATION_BACKUP_KEY = 'migrationBackup:v1.2.1';

/**
 * @param {{ area: StorageArea, clock?: () => number }} options
 */
function createStorage({ area, clock = () => Date.now() }) {
  async function loadAll() {
    const raw = await area.get([
      'schemaVersion', 'groups', 'watchlist', 'boardConfig',
      'watchlist_legacy', MIGRATION_BACKUP_KEY
    ]);
    if (raw.schemaVersion === SCHEMA_VERSION) return sanitizeV2(raw, clock());
    return migrateToV2(raw, area, clock());
  }

  // ===== 串行写入队列 =====
  // 所有用户数据修改在同一个 Promise 链上执行，避免并发读改写丢失更新
  let writeQueue = Promise.resolve();
  function enqueueWrite(operation) {
    const next = writeQueue.then(operation, operation);
    writeQueue = next.then(() => undefined, () => undefined);
    return next;
  }
  function mutateUserData(mutator) {
    return enqueueWrite(async () => {
      const data = await loadAll();
      const result = await mutator(data);
      await area.set({
        schemaVersion: SCHEMA_VERSION,
        groups: data.groups,
        watchlist: data.watchlist,
        boardConfig: data.boardConfig
      });
      return result;
    });
  }

  // ===== 迁移：v0/v1 → v2 =====
  async function migrateToV2(raw, area, now) {
    if (!raw[MIGRATION_BACKUP_KEY]) {
      await area.set({
        [MIGRATION_BACKUP_KEY]: {
          savedAt: now,
          groups: raw.groups ?? null,
          watchlist: raw.watchlist ?? null,
          boardConfig: raw.boardConfig ?? null,
          watchlist_legacy: raw.watchlist_legacy ?? null
        }
      });
    }
    // v0 扁平列表：无 watchlist 时先从 watchlist_legacy 还原 v1 结构，再走 v2 清洗
    let source = raw;
    if (!raw.watchlist && Array.isArray(raw.watchlist_legacy)) {
      source = {
        ...raw,
        watchlist: raw.watchlist_legacy.map((item, index) => {
          const entry = typeof item === 'string' ? { code: item } : item;
          return {
            code: entry.code,
            name: entry.name || entry.code,
            groupIds: [DEFAULT_GROUP_ID],   // sanitizeV2 会移除 g_all
            manualOrder: {},
            pinned: {},
            addedAt: entry.addedAt || now - index * 1000
          };
        })
      };
    }
    const migrated = sanitizeV2({ ...source, schemaVersion: SCHEMA_VERSION }, now);
    await area.set(migrated);
    return migrated;
  }

  // ===== v2 数据清洗（幂等）=====
  function sanitizeV2(raw, now) {
    // 分组：确保默认「全部」存在且固定首位，最多 1 个默认 + 19 个自定义
    const sourceGroups = Array.isArray(raw.groups) ? raw.groups.map((g) => ({ ...g })) : [];
    const allIndex = sourceGroups.findIndex((g) => g && g.groupId === DEFAULT_GROUP_ID);
    const groups = [];
    if (allIndex >= 0) {
      const all = sourceGroups.splice(allIndex, 1)[0];
      groups.push({ ...all, name: all.name || DEFAULT_GROUP_NAME, order: 0, isDefault: true, createdAt: all.createdAt ?? now, updatedAt: all.updatedAt ?? now });
    } else {
      groups.push({ groupId: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, order: 0, isDefault: true, createdAt: now, updatedAt: now });
    }
    const seenGroupIds = new Set([DEFAULT_GROUP_ID]);
    sourceGroups
      .filter((g) => {
        if (!g || typeof g.groupId !== 'string' || seenGroupIds.has(g.groupId)) return false;
        seenGroupIds.add(g.groupId);
        return true;
      })
      .slice(0, MAX_GROUPS - 1)
      .forEach((g, index) => {
        g.order = index + 1;
        g.createdAt = g.createdAt ?? now;
        g.updatedAt = g.updatedAt ?? now;
        groups.push(g);
      });
    const validGroupIds = new Set(groups.map((g) => g.groupId));

    // 自选股：规范化代码、丢弃无效代码、按代码合并重复
    const byCode = new Map();
    const sourceWatchlist = Array.isArray(raw.watchlist) ? raw.watchlist : [];
    for (const stock of sourceWatchlist) {
      if (!stock || typeof stock !== 'object') continue;
      const code = StockUtils.normalizeStockCode(stock.code);
      if (!code) continue;
      const customGroupIds = Array.isArray(stock.groupIds)
        ? [...new Set(stock.groupIds.filter((id) => id !== DEFAULT_GROUP_ID && validGroupIds.has(id)))]
        : [];
      const normalized = {
        code,
        name: typeof stock.name === 'string' ? stock.name : '',
        groupIds: customGroupIds,
        manualOrder: stock.manualOrder && typeof stock.manualOrder === 'object' ? { ...stock.manualOrder } : {},
        pinned: stock.pinned && typeof stock.pinned === 'object' ? { ...stock.pinned } : {},
        addedAt: Number.isFinite(stock.addedAt) ? stock.addedAt : now
      };
      const existing = byCode.get(code);
      if (existing) {
        existing.groupIds = [...new Set([...existing.groupIds, ...customGroupIds])];
        if (normalized.name && !existing.name) existing.name = normalized.name;
        existing.manualOrder = { ...normalized.manualOrder, ...existing.manualOrder };
        existing.pinned = { ...normalized.pinned, ...existing.pinned };
        if (normalized.addedAt < existing.addedAt) existing.addedAt = normalized.addedAt;
      } else {
        byCode.set(code, normalized);
      }
    }
    const watchlist = [...byCode.values()];

    const boardConfig = raw.boardConfig && typeof raw.boardConfig === 'object' ? { ...raw.boardConfig } : {};
    return { schemaVersion: SCHEMA_VERSION, groups, watchlist, boardConfig };
  }

  // ===== 行情缓存（按股票代码独立分键）=====
  function quoteCacheKey(code) {
    return `quoteCache:${code}`;
  }

  async function readQuoteCache(codes) {
    const normalized = [...new Set(codes.map(StockUtils.normalizeStockCode).filter(Boolean))];
    const raw = await area.get(normalized.map(quoteCacheKey));
    const result = {};
    for (const code of normalized) {
      const value = raw[quoteCacheKey(code)];
      if (
        value?.cacheVersion === 1 &&
        value.code === code &&
        Number.isFinite(value.fetchedAt) &&
        value.quote &&
        typeof value.quote === 'object'
      ) result[code] = value;
    }
    return result;
  }

  async function writeQuoteCache(entries) {
    const patch = {};
    for (const [code, entry] of Object.entries(entries)) {
      patch[quoteCacheKey(code)] = { ...entry, cacheVersion: 1, code };
    }
    if (Object.keys(patch).length) await area.set(patch);
  }

  async function deleteQuoteCache(codes) {
    const keys = codes.map(StockUtils.normalizeStockCode).filter(Boolean).map(quoteCacheKey);
    if (keys.length) await area.remove(keys);
  }

  // ===== 分组操作 =====
  async function createGroup(name) {
    return mutateUserData(async (data) => {
      if (data.groups.length >= MAX_GROUPS) throw new Error('分组已达上限（20），请先删除无用分组');
      if (data.groups.some((g) => g.name === name)) throw new Error('分组名已存在，请更换');
      const now = clock();
      const group = { groupId: 'g_' + now, name, order: data.groups.length, isDefault: false, createdAt: now, updatedAt: now };
      data.groups.push(group);
      return group;
    });
  }

  async function renameGroup(groupId, name) {
    return mutateUserData(async (data) => {
      if (data.groups.some((g) => g.groupId !== groupId && g.name === name)) throw new Error('分组名已存在，请更换');
      const group = data.groups.find((g) => g.groupId === groupId);
      if (group) { group.name = name; group.updatedAt = clock(); }
    });
  }

  async function deleteGroup(groupId) {
    if (groupId === DEFAULT_GROUP_ID) throw new Error('默认分组不可删除');
    return mutateUserData(async (data) => {
      data.groups = data.groups.filter((g) => g.groupId !== groupId);
      data.watchlist.forEach((stock) => {
        stock.groupIds = stock.groupIds.filter((id) => id !== groupId);
        if (stock.manualOrder) delete stock.manualOrder[groupId];
        if (stock.pinned) delete stock.pinned[groupId];
      });
      delete data.boardConfig[groupId];
    });
  }

  async function reorderGroups(newOrderIds) {
    return mutateUserData(async (data) => {
      const map = new Map(data.groups.map((g) => [g.groupId, g]));
      const ordered = [];
      const defaultGroup = map.get(DEFAULT_GROUP_ID);
      if (defaultGroup) { defaultGroup.order = 0; ordered.push(defaultGroup); }
      (newOrderIds || []).forEach((id) => {
        if (id !== DEFAULT_GROUP_ID && map.has(id)) {
          const group = map.get(id);
          group.order = ordered.length;
          ordered.push(group);
        }
      });
      data.groups.forEach((g) => {
        if (!ordered.includes(g)) { g.order = ordered.length; ordered.push(g); }
      });
      data.groups = ordered;
    });
  }

  // ===== 自选股操作（v2：不存储 g_all 成员标记）=====
  async function addStock(code, name, groupIds) {
    return mutateUserData(async (data) => {
      const normalizedCode = StockUtils.normalizeStockCode(code);
      if (!normalizedCode) throw new Error('股票代码格式不正确');
      const validCustomIds = new Set(data.groups
        .filter((group) => group.groupId !== DEFAULT_GROUP_ID)
        .map((group) => group.groupId));
      const targetIds = [...new Set((groupIds || []).filter((id) => validCustomIds.has(id)))];
      let stock = data.watchlist.find((s) => s.code === normalizedCode);
      if (stock) {
        targetIds.forEach((id) => { if (!stock.groupIds.includes(id)) stock.groupIds.push(id); });
      } else {
        stock = { code: normalizedCode, name: name || normalizedCode, groupIds: targetIds, manualOrder: {}, pinned: {}, addedAt: clock() };
        data.watchlist.push(stock);
      }
      return stock;
    });
  }

  async function removeStock(code, groupId) {
    return mutateUserData(async (data) => {
      const index = data.watchlist.findIndex((s) => s.code === code);
      if (index < 0) return;
      if (groupId && groupId !== DEFAULT_GROUP_ID) {
        const stock = data.watchlist[index];
        stock.groupIds = stock.groupIds.filter((id) => id !== groupId);
        if (stock.manualOrder) delete stock.manualOrder[groupId];
        if (stock.pinned) delete stock.pinned[groupId];
      } else {
        // 从「全部」移除 = 全局删除，同时清理行情缓存键
        data.watchlist.splice(index, 1);
        const normalized = StockUtils.normalizeStockCode(code);
        if (normalized) await area.remove([quoteCacheKey(normalized)]);
      }
    });
  }

  async function removeStocksBatch(codes, groupId) {
    return mutateUserData(async (data) => {
      const codeSet = new Set(codes);
      if (groupId && groupId !== DEFAULT_GROUP_ID) {
        data.watchlist.forEach((stock) => {
          if (codeSet.has(stock.code)) {
            stock.groupIds = stock.groupIds.filter((id) => id !== groupId);
            if (stock.manualOrder) delete stock.manualOrder[groupId];
            if (stock.pinned) delete stock.pinned[groupId];
          }
        });
      } else {
        data.watchlist = data.watchlist.filter((stock) => !codeSet.has(stock.code));
        const cacheKeys = codes.map(StockUtils.normalizeStockCode).filter(Boolean).map(quoteCacheKey);
        if (cacheKeys.length) await area.remove(cacheKeys);
      }
    });
  }

  async function moveStocksToGroups(codes, fromGroupId, targetGroupIds) {
    return mutateUserData(async (data) => {
      const targets = [...new Set((targetGroupIds || []).filter((id) => id !== DEFAULT_GROUP_ID))];
      codes.forEach((code) => {
        const stock = data.watchlist.find((s) => s.code === code);
        if (!stock) return;
        if (fromGroupId && fromGroupId !== DEFAULT_GROUP_ID) {
          stock.groupIds = stock.groupIds.filter((id) => id !== fromGroupId);
          if (stock.manualOrder) delete stock.manualOrder[fromGroupId];
          if (stock.pinned) delete stock.pinned[fromGroupId];
        }
        targets.forEach((id) => { if (!stock.groupIds.includes(id)) stock.groupIds.push(id); });
      });
    });
  }

  async function setManualOrder(groupId, codesOrMap) {
    return mutateUserData(async (data) => {
      if (Array.isArray(codesOrMap)) {
        codesOrMap.forEach((code, index) => {
          const stock = data.watchlist.find((s) => s.code === code);
          if (stock) {
            if (!stock.manualOrder) stock.manualOrder = {};
            stock.manualOrder[groupId] = index;
          }
        });
      } else {
        Object.entries(codesOrMap).forEach(([code, order]) => {
          const stock = data.watchlist.find((s) => s.code === code);
          if (stock) {
            if (!stock.manualOrder) stock.manualOrder = {};
            stock.manualOrder[groupId] = order;
          }
        });
      }
    });
  }

  async function togglePin(groupId, code) {
    return mutateUserData(async (data) => {
      const stock = data.watchlist.find((s) => s.code === code);
      if (!stock) return;
      if (!stock.pinned) stock.pinned = {};
      if (stock.pinned[groupId]) {
        delete stock.pinned[groupId];
        if (Object.keys(stock.pinned).length === 0) delete stock.pinned;
      } else {
        stock.pinned[groupId] = true;
      }
    });
  }

  // ===== 看板配置 =====
  async function getBoardConfig(groupId) {
    const data = await loadAll();
    return data.boardConfig[groupId] || { viewMode: 'grid', sortField: 'manual', sortDirection: 'desc', columns: ['name', 'price', 'change', 'changePercent'], columnOrder: ['name', 'price', 'change', 'changePercent'] };
  }

  async function saveBoardConfigForGroup(groupId, cfg) {
    return mutateUserData(async (data) => {
      data.boardConfig[groupId] = { ...(data.boardConfig[groupId] || {}), ...cfg };
      return data.boardConfig[groupId];
    });
  }

  // ===== 原子保存方法（同样走串行队列）=====
  async function saveGroups(groups) {
    return mutateUserData(async (data) => { data.groups = groups; });
  }

  async function saveWatchlist(watchlist) {
    return mutateUserData(async (data) => { data.watchlist = watchlist; });
  }

  async function saveBoardConfig(boardConfig) {
    return mutateUserData(async (data) => { data.boardConfig = boardConfig; });
  }

  return {
    loadAll,
    saveGroups,
    saveWatchlist,
    saveBoardConfig,
    createGroup,
    renameGroup,
    deleteGroup,
    reorderGroups,
    addStock,
    removeStock,
    removeStocksBatch,
    moveStocksToGroups,
    setManualOrder,
    togglePin,
    getBoardConfig,
    saveBoardConfigForGroup,
    readQuoteCache,
    writeQuoteCache,
    deleteQuoteCache
  };
}

const Storage = typeof chrome !== 'undefined'
  ? createStorage({ area: chrome.storage.local })
  : null;

if (typeof module !== 'undefined') {
  module.exports = { createStorage, SCHEMA_VERSION, DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME, MAX_GROUPS };
}
