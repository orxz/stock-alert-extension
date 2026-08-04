// scripts/generate-capacity-fixture.mjs
// Task 19 Step 1 — 确定性容量夹具生成器（20 组 / 500 股）。
// 所有时间戳以 BASE_EPOCH 为锚点，所有股票代码从固定前缀池确定性派生，
// 缓存条目按固定 age/status 分布生成。同输入两次生成的 SHA-256 必须一致。
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const CAPACITY_CONFIG = Object.freeze({
  groupCount: 20,
  stockCount: 500,
  baseEpoch: 1_700_000_000_000,
  // 缓存 age 锚点（毫秒）：fresh < 30s, cached 5min, stale 1h, missing 无缓存。
  freshAgeMs: 1_000,
  cachedAgeMs: 300_000,
  staleAgeMs: 3_600_000,
  // 市场前缀池（与 src/domain/stock.ts inferMarket 严格对齐）。
  shPrefixes: ['600', '601', '603', '605', '688', '689'],
  szPrefixes: ['000', '001', '002', '003', '300', '301'],
  bjPrefixes: ['920', '830', '870', '880', '430', '480']
});

/**
 * 为序号 index 派生确定性合法股票代码。
 * 轮转 sh/sz/bj 市场与前缀，后三位为 index 取模 1000（左侧补零）。
 */
export function codeFor(index) {
  const { shPrefixes, szPrefixes, bjPrefixes } = CAPACITY_CONFIG;
  const markets = [
    { market: 'sh', prefixes: shPrefixes },
    { market: 'sz', prefixes: szPrefixes },
    { market: 'bj', prefixes: bjPrefixes }
  ];
  const slot = markets[index % markets.length];
  const prefix = slot.prefixes[Math.floor(index / markets.length) % slot.prefixes.length];
  const suffix = String(index % 1000).padStart(3, '0');
  return `${slot.market}${prefix}${suffix}`;
}

/** 第 i 个自定义分组（i 从 1 开始）。 */
function customGroup(index) {
  const { baseEpoch } = CAPACITY_CONFIG;
  const groupId = `g_${String(index).padStart(3, '0')}`;
  return {
    groupId,
    name: `分组${index}`,
    order: index,
    isDefault: false,
    createdAt: baseEpoch + index * 1_000,
    updatedAt: baseEpoch + index * 1_000
  };
}

function allGroup() {
  const { baseEpoch } = CAPACITY_CONFIG;
  return {
    groupId: 'g_all',
    name: '全部',
    order: 0,
    isDefault: true,
    createdAt: baseEpoch,
    updatedAt: baseEpoch
  };
}

/** 为每只股票分配确定性 groupIds（不含 g_all）与 manualOrder。 */
function stockFor(index, groups) {
  const { baseEpoch } = CAPACITY_CONFIG;
  const code = codeFor(index);
  // 自定义分组按取模分配：每只股票落到 1~2 个自定义分组中。
  const primary = (index % 19) + 1;
  const secondary = ((index * 7) % 19) + 1;
  const groupIds = primary === secondary ? [`g_${String(primary).padStart(3, '0')}`] : [
    `g_${String(primary).padStart(3, '0')}`,
    `g_${String(secondary).padStart(3, '0')}`
  ];
  // manualOrder 为每个自定义分组确定性赋值；g_all 用全局序。
  const manualOrder = { g_all: index };
  for (const g of groups) {
    if (g.groupId !== 'g_all') manualOrder[g.groupId] = (index + Number(g.groupId.split('_')[1])) % 500;
  }
  const pinned = {};
  // 每 10 只股票在第 1 个分组中置顶。
  if (index % 10 === 0) pinned[groupIds[0]] = true;
  return {
    code,
    name: `股票${index}`,
    groupIds,
    manualOrder,
    pinned,
    addedAt: baseEpoch + index * 10
  };
}

function configsFor(groups) {
  const boardConfig = {};
  // g_all 为 list/manual/asc，偶数序自定义分组为 grid，奇数序为 list。
  for (const g of groups) {
    const idx = g.order;
    boardConfig[g.groupId] = {
      viewMode: idx % 2 === 0 ? 'list' : 'grid',
      sortField: idx % 3 === 0 ? 'manual' : 'changePercent',
      sortDirection: idx % 2 === 0 ? 'asc' : 'desc',
      priceHidden: idx % 5 === 0
    };
  }
  return boardConfig;
}

/**
 * 为每只股票生成确定性缓存条目（按 index 模 4 分布 fresh/cached/stale/missing）。
 * 缺失（missing）的股票不出现在返回对象中。
 */
function cachesFor(watchlist) {
  const { baseEpoch, freshAgeMs, cachedAgeMs, staleAgeMs } = CAPACITY_CONFIG;
  const cache = {};
  watchlist.forEach((s, index) => {
    const bucket = index % 4;
    if (bucket === 3) return; // missing
    const age = bucket === 0 ? freshAgeMs : bucket === 1 ? cachedAgeMs : staleAgeMs;
    const price = 10 + (index % 100);
    cache[`quoteCache:${s.code}`] = {
      cacheVersion: 1,
      code: s.code,
      provider: index % 2 === 0 ? 'eastmoney' : 'sina',
      fetchedAt: baseEpoch - age,
      quote: {
        code: s.code,
        name: s.name,
        price,
        change: (index % 7) - 3,
        changePercent: (((index % 7) - 3) / price) * 100,
        amount: index * 1000
      }
    };
  });
  return cache;
}

/** 生成完整容量夹具对象（纯函数，确定性）。 */
export function buildCapacityFixture(config = CAPACITY_CONFIG) {
  const { groupCount, baseEpoch } = config;
  const groups = [allGroup()];
  for (let i = 1; i < groupCount; i += 1) groups.push(customGroup(i));
  const watchlist = Array.from({ length: config.stockCount }, (_, i) => stockFor(i, groups));
  const boardConfig = configsFor(groups);
  const cache = cachesFor(watchlist);
  return {
    schemaVersion: 2,
    groups,
    watchlist,
    boardConfig,
    capturedAt: baseEpoch,
    ...cache
  };
}

/** 将夹具序列化为确定性 JSON 字符串（2 空格缩进，最终换行）。 */
export function serializeFixture(fixture) {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

/** 计算序列化字节串的 SHA-256。 */
export function sha256Of(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * 生成两次夹具并断言 SHA-256 完全一致。
 * 返回 { fixture, sha256, text }。若不一致则抛出。
 */
export function verifyDeterminism(config = CAPACITY_CONFIG) {
  const first = serializeFixture(buildCapacityFixture(config));
  const second = serializeFixture(buildCapacityFixture(config));
  const h1 = sha256Of(first);
  const h2 = sha256Of(second);
  if (h1 !== h2) {
    throw new Error(`capacity fixture non-deterministic: ${h1} != ${h2}`);
  }
  return { text: first, sha256: h1 };
}

async function main() {
  const { text, sha256 } = verifyDeterminism();
  const outDir = join(REPO_ROOT, 'tests/fixtures/capacity');
  const outFile = join(outDir, 'portfolio-500.json');
  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, text, 'utf8');
  console.log(`capacity fixture written: ${outFile}`);
  console.log(`sha256: ${sha256}`);
  console.log(`groups: ${CAPACITY_CONFIG.groupCount}, stocks: ${CAPACITY_CONFIG.stockCount}`);
}

const entryPath = process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('generate-capacity-fixture FAILED', error?.stack ?? error);
    process.exit(1);
  });
}
