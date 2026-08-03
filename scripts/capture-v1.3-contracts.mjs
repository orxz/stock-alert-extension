// scripts/capture-v1.3-contracts.mjs
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
globalThis.StockUtils = require('../stock-utils.js');
globalThis.QuoteFormat = require('../quote-format.js');
const { createStorage } = require('../storage.js');

const NOW = Date.parse('2026-08-03T01:30:00.000Z');
const envelope = (payload) => ({ contractVersion: 1, sourceVersion: '1.3.0', capturedAt: NOW, payload });
const canonicalize = (value) => Array.isArray(value)
  ? value.map(canonicalize)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    : value;
const stable = (value) => `${JSON.stringify(canonicalize(value), null, 2)}\n`;

export async function capture(output = new URL('../tests/fixtures/v1.3/', import.meta.url)) {
  await mkdir(output, { recursive: true });
  const cases = createFixedCases(NOW);
  for (const [name, raw] of Object.entries(cases.storage)) {
    const area = createMemoryArea(raw);
    const data = await createStorage({ area, clock: () => NOW }).loadAll();
    await writeFile(new URL(`storage-${name}.json`, output), stable(envelope({ input: raw, output: data })));
  }
  await writeFile(new URL('quote-snapshot.json', output), stable(envelope(cases.quoteSnapshot)));
  await writeFile(new URL('formatting.json', output), stable(envelope(cases.formatting)));
}

function createMemoryArea(seed) {
  let state = structuredClone(seed);
  return {
    async get(keys = null) {
      if (keys === null) return structuredClone(state);
      const selected = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (Object.hasOwn(state, key)) selected[key] = structuredClone(state[key]);
      }
      return selected;
    },
    async set(patch) { state = { ...state, ...structuredClone(patch) }; },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key]; }
  };
}

function createFixedCases(now) {
  const group = { groupId: 'g_watch', name: '关注', order: 1, isDefault: false, createdAt: now - 10_000, updatedAt: now - 5_000 };
  const duplicate = { code: '600519', name: '贵州茅台', groupIds: ['g_all', 'g_watch'], manualOrder: { g_watch: 0 }, pinned: { g_watch: true }, addedAt: now - 20_000 };
  const storage = {
    v0: { watchlist_legacy: [{ code: '600519', name: '贵州茅台', addedAt: now - 20_000 }] },
    v1: { schemaVersion: 1, groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true }, group], watchlist: [duplicate, { ...duplicate, code: 'sh600519', name: '' }], boardConfig: { g_watch: { viewMode: 'list', sortField: 'manual' } } },
    v2: { schemaVersion: 2, groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true }, group], watchlist: [{ ...duplicate, code: 'sh600519', groupIds: ['g_watch'] }], boardConfig: { g_watch: { viewMode: 'list', sortField: 'manual', priceHidden: true } }, 'migrationBackup:v1.2.1': { savedAt: now - 30_000 } }
  };
  const quote = { code: 'sh600519', price: 1500, change: 12, changePercent: 0.81, amount: 2_000_000_000 };
  return {
    storage,
    quoteSnapshot: { results: { sh600519: { code: 'sh600519', status: 'fresh', source: 'eastmoney', fetchedAt: now, quote } }, counts: { fresh: 1, cached: 0, missing: 0 }, attemptedAt: now, succeededAt: now, generation: 1 },
    formatting: {
      badge: globalThis.QuoteFormat.formatBadge(quote.changePercent),
      freshState: globalThis.QuoteFormat.formatBadgeState({ status: 'fresh', quote }),
      cachedLine: globalThis.QuoteFormat.formatTooltipLine({ code: 'sh600519', name: '贵州茅台' }, { status: 'cached', fetchedAt: now - 60_000, quote }, now)
    }
  };
}

// CLI 入口：`node scripts/capture-v1.3-contracts.mjs`
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  capture()
    .then(() => console.log('captured v1.3 contracts -> tests/fixtures/v1.3/'))
    .catch((error) => {
      console.error('capture failed:', error);
      process.exitCode = 1;
    });
}
