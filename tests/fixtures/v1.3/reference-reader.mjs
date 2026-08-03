// tests/fixtures/v1.3/reference-reader.mjs
export function readWithV13Rules(raw, now) {
  const groups = sanitizeGroups(raw.groups, now);
  const valid = new Set(groups.map((group) => group.groupId));
  const watchlist = sanitizeStocks(raw.watchlist, valid, now);
  const boardConfig = raw.boardConfig && typeof raw.boardConfig === 'object'
    ? structuredClone(raw.boardConfig)
    : {};
  return { schemaVersion: 2, groups, watchlist, boardConfig };
}

function sanitizeGroups(value, now) {
  const input = Array.isArray(value) ? value.filter((item) => item && typeof item.groupId === 'string') : [];
  const custom = [];
  const seen = new Set(['g_all']);
  for (const item of input) {
    if (item.groupId === 'g_all' || seen.has(item.groupId) || custom.length === 19) continue;
    seen.add(item.groupId);
    custom.push({ ...item, order: custom.length + 1, isDefault: false, createdAt: item.createdAt ?? now, updatedAt: item.updatedAt ?? now });
  }
  const existingAll = input.find((item) => item.groupId === 'g_all');
  return [{ ...existingAll, groupId: 'g_all', name: existingAll?.name || '全部', order: 0, isDefault: true, createdAt: existingAll?.createdAt ?? now, updatedAt: existingAll?.updatedAt ?? now }, ...custom];
}

function sanitizeStocks(value, validGroupIds, now) {
  const byCode = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    const code = normalizeReferenceCode(item?.code);
    if (!code) continue;
    const next = {
      code,
      name: typeof item.name === 'string' ? item.name : '',
      groupIds: [...new Set((Array.isArray(item.groupIds) ? item.groupIds : []).filter((id) => id !== 'g_all' && validGroupIds.has(id)))],
      manualOrder: item.manualOrder && typeof item.manualOrder === 'object' ? { ...item.manualOrder } : {},
      pinned: item.pinned && typeof item.pinned === 'object' ? { ...item.pinned } : {},
      addedAt: Number.isFinite(item.addedAt) ? item.addedAt : now
    };
    const current = byCode.get(code);
    if (!current) byCode.set(code, next);
    else {
      current.groupIds = [...new Set([...current.groupIds, ...next.groupIds])];
      current.manualOrder = { ...next.manualOrder, ...current.manualOrder };
      current.pinned = { ...next.pinned, ...current.pinned };
      current.addedAt = Math.min(current.addedAt, next.addedAt);
      if (!current.name) current.name = next.name;
    }
  }
  return [...byCode.values()];
}

function normalizeReferenceCode(input) {
  const match = /^(?:(sh|sz|bj))?(\d{6})$/.exec(String(input ?? '').trim().toLowerCase());
  if (!match) return null;
  const market = /^(600|601|603|605|688|689)/.test(match[2]) ? 'sh'
    : /^(000|001|002|003|300|301)/.test(match[2]) ? 'sz'
      : /^(920|8|4)/.test(match[2]) ? 'bj' : null;
  return market && (!match[1] || match[1] === market) ? `${market}${match[2]}` : null;
}
