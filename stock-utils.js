// stock-utils.js — 共享股票视图与排序语义（Popup / Background / Storage 共用）
// 「全部」(g_all) 是计算视图，永不作为成员标记存储

const StockUtils = (() => {
  const ALL_GROUP_ID = 'g_all';

  function normalizeStockCode(input) {
    const value = String(input || '').trim().toLowerCase();
    const match = value.match(/^(?:(sh|sz|bj))?(\d{6})$/);
    if (!match) return null;
    const [, suppliedPrefix, digits] = match;
    let inferredPrefix = null;
    if (/^(600|601|603|605|688|689)/.test(digits)) inferredPrefix = 'sh';
    else if (/^(000|001|002|003|300|301)/.test(digits)) inferredPrefix = 'sz';
    else if (/^(4|8|920)/.test(digits)) inferredPrefix = 'bj';
    if (!inferredPrefix || (suppliedPrefix && suppliedPrefix !== inferredPrefix)) return null;
    return inferredPrefix + digits;
  }

  function getStocksForGroup(watchlist, groupId) {
    const list = Array.isArray(watchlist) ? watchlist : [];
    if (groupId === ALL_GROUP_ID) return [...list];
    return list.filter((stock) => Array.isArray(stock.groupIds) && stock.groupIds.includes(groupId));
  }

  function countStocksForGroup(watchlist, groupId) {
    return getStocksForGroup(watchlist, groupId).length;
  }

  function sortStocks(stocks, quoteResults, groupId, field, direction) {
    const multiplier = direction === 'asc' ? 1 : -1;
    return [...stocks].sort((left, right) => {
      const leftPinned = left.pinned?.[groupId] ? 1 : 0;
      const rightPinned = right.pinned?.[groupId] ? 1 : 0;
      if (leftPinned !== rightPinned) return rightPinned - leftPinned;
      if (field === 'manual') {
        return (left.manualOrder?.[groupId] ?? 9999) - (right.manualOrder?.[groupId] ?? 9999);
      }
      if (field === 'addedAt') return ((left.addedAt || 0) - (right.addedAt || 0)) * multiplier;
      if (field === 'name') return String(left.name || '').localeCompare(String(right.name || '')) * multiplier;
      const leftValue = quoteResults?.[left.code]?.quote?.[field];
      const rightValue = quoteResults?.[right.code]?.quote?.[field];
      const leftMissing = typeof leftValue !== 'number';
      const rightMissing = typeof rightValue !== 'number';
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      if (leftMissing) return 0;
      return (leftValue - rightValue) * multiplier;
    });
  }

  return { ALL_GROUP_ID, normalizeStockCode, getStocksForGroup, countStocksForGroup, sortStocks };
})();

if (typeof module !== 'undefined') module.exports = StockUtils;
