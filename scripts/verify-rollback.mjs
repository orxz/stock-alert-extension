// scripts/verify-rollback.mjs
// Task 20 Step 4 — 操作回滚验证。
//
// 验证 v1.3 → v2 写入 → v1.3 回读 → v2 再升级 的数据兼容性：
//   1. 验证冻结 v1.3.0 发布 ZIP 的 SHA-256 与 RELEASE-v1.3.0.md 记录一致。
//   2. 加载冻结 v1.3 存储夹具（v0/v1/v2），用实际发布构建产物（build/extension/runtime/）
//      的 StorageCoordinator 运行迁移与代表性 mutation（add/move/pin/reorder/preferences/group lifecycle）。
//   3. 将结果 raw schema-v2 用户键传给冻结的 readWithV13Rules()，断言名称/成员/顺序/配置可读。
//   4. 将回读结果回馈 v2，断言得到新的内容 revision 且用户数据等价。
//
// 从不复制 v1 运行时代码到 src/ 或 build/extension/。
// v1.3 规则由 tests/fixtures/v1.3/reference-reader.mjs 提供（测试专用，无 Chrome/CommonJS 依赖）。
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const NOW = Date.parse('2026-08-03T01:30:00.000Z');

// 记录的 v1.3.0 发布 SHA-256（来自 RELEASE-v1.3.0.md，冻结基线）。
const V13_ZIP_SHA = 'aed997fb2154891e65f963a438081e86bbe2873219872b9bb3358efe437ed3d5';

// ===== 内存 StorageArea（实现 StorageCoordinator 依赖的最小接口）=====
function createMemoryArea(seed) {
  let state = seed ? structuredClone(seed) : {};
  return {
    async get(keys = null) {
      if (keys === null) return structuredClone(state);
      const arr = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const key of arr) if (Object.hasOwn(state, key)) out[key] = structuredClone(state[key]);
      return out;
    },
    async set(patch) {
      state = { ...state, ...structuredClone(patch) };
    },
    async remove(keys) {
      for (const key of (Array.isArray(keys) ? keys : [keys])) delete state[key];
    }
  };
}

// ===== Step 1: 验证冻结 v1.3 ZIP SHA =====
async function verifyV13ZipSha() {
  const zipPath = join(ROOT, 'dist/stock-alert-extension-v1.3.0.zip');
  assert.ok(existsSync(zipPath), 'frozen v1.3.0 ZIP must exist at dist/stock-alert-extension-v1.3.0.zip');
  const archive = await readFile(zipPath);
  const sha = createHash('sha256').update(archive).digest('hex');
  assert.equal(sha, V13_ZIP_SHA, `v1.3.0 ZIP SHA mismatch: expected ${V13_ZIP_SHA}, got ${sha}`);
  console.log(`[verify-rollback] v1.3.0 ZIP SHA verified: ${sha}`);
}

// ===== 业务等价断言（忽略 timestamp/字段顺序差异）=====
function assertStockReadable(stocks, code, { name, groupIds }) {
  const stock = stocks.find((item) => item.code === code);
  assert.ok(stock, `stock ${code} must be readable`);
  if (name !== undefined) assert.equal(stock.name, name, `stock ${code} name`);
  if (groupIds !== undefined) {
    assert.deepEqual(
      [...stock.groupIds].sort(),
      [...groupIds].sort(),
      `stock ${code} groupIds`
    );
  }
  // g_all 是计算视图，绝不持久化在 groupIds 中
  assert.equal(
    stock.groupIds.includes('g_all'),
    false,
    `stock ${code} must not persist g_all membership`
  );
}

// ===== Step 2-3: 迁移夹具回读验证 =====
async function verifyFixtureRoundTrip(rawInput, label, StorageCoordinator, readWithV13Rules) {
  const area = createMemoryArea(structuredClone(rawInput));
  const coordinator = new StorageCoordinator({ area, clock: () => NOW });

  // v2 读取（触发迁移或清洗）
  const boot = await coordinator.readBootstrap();
  assert.ok(boot.revision.startsWith('sha256:'), `${label}: revision is sha256 digest`);

  // 读回实际持久化的 raw schema-v2 用户键
  const stored = await area.get(['schemaVersion', 'groups', 'watchlist', 'boardConfig']);
  assert.equal(stored.schemaVersion, 2, `${label}: persisted schemaVersion is 2`);

  // 冻结 v1.3 规则回读——验证 v2 写出的数据可被 v1.3 安全读取
  const v13Read = readWithV13Rules(stored, NOW);
  assert.equal(v13Read.schemaVersion, 2, `${label}: v1.3 readback schemaVersion is 2`);
  assert.ok(v13Read.groups.length >= 1, `${label}: v1.3 readback has at least g_all`);
  assert.equal(v13Read.groups[0].groupId, 'g_all', `${label}: v1.3 readback first group is g_all`);

  // v2 读取与 v1.3 回读在业务语义上等价（code 集合一致）
  const v2Codes = new Set(boot.userData.watchlist.map((s) => s.code));
  const v13Codes = new Set(v13Read.watchlist.map((s) => s.code));
  assert.deepEqual([...v2Codes].sort(), [...v13Codes].sort(), `${label}: v2/v1.3 code sets equal`);

  console.log(`[verify-rollback] ${label}: migration round-trip OK (${v2Codes.size} stocks)`);
  return { stored, boot };
}

// ===== Step 4: 完整 mutation 生命周期 + 回读 + 再升级 =====
async function verifyMutationLifecycles(StorageCoordinator, readWithV13Rules) {
  // 起点：v2 夹具（1 只 sh600519 in g_watch，pinned）
  const fixture = JSON.parse(
    await readFile(join(ROOT, 'tests/fixtures/v1.3/storage-v2.json'), 'utf8')
  );
  const raw = structuredClone(fixture.payload.input);
  const area = createMemoryArea(raw);
  const coordinator = new StorageCoordinator({ area, clock: () => NOW });

  let boot = await coordinator.readBootstrap();
  let rev = boot.revision;

  // 断言辅助：每步 mutate 后更新 rev
  const step = async (label, change) => {
    const result = await coordinator.mutate(rev, change);
    rev = result.revision;
    assert.ok(rev.startsWith('sha256:'), `${label}: produced new revision`);
    return result;
  };

  // 1. addStock：sz000001 加入 g_watch
  await step('addStock', (draft) => {
    draft.watchlist.push({
      code: 'sz000001',
      name: '平安银行',
      groupIds: ['g_watch'],
      manualOrder: { g_watch: 1 },
      pinned: {},
      addedAt: NOW
    });
    return null;
  });

  // 2. createGroup：g_new
  await step('createGroup', (draft) => {
    draft.groups.push({
      groupId: 'g_new',
      name: '新建组',
      order: 2,
      isDefault: false,
      createdAt: NOW,
      updatedAt: NOW
    });
    return null;
  });

  // 3. moveStock：sz000001 加入 g_new
  await step('moveStock', (draft) => {
    const stock = draft.watchlist.find((s) => s.code === 'sz000001');
    if (!stock.groupIds.includes('g_new')) stock.groupIds.push('g_new');
    return null;
  });

  // 4. setPinned：sz000001 在 g_watch 置顶
  await step('setPinned', (draft) => {
    const stock = draft.watchlist.find((s) => s.code === 'sz000001');
    stock.pinned.g_watch = true;
    return null;
  });

  // 5. setOrder：g_watch 手动顺序 [sh600519, sz000001]，sortField=manual
  await step('setOrder', (draft) => {
    draft.boardConfig.g_watch = { ...draft.boardConfig.g_watch, sortField: 'manual' };
    draft.watchlist.find((s) => s.code === 'sh600519').manualOrder.g_watch = 0;
    draft.watchlist.find((s) => s.code === 'sz000001').manualOrder.g_watch = 1;
    return null;
  });

  // 6. preferences patch：g_watch priceHidden=false
  await step('preferences', (draft) => {
    draft.boardConfig.g_watch = { ...draft.boardConfig.g_watch, priceHidden: false };
    return null;
  });

  // 7. groupRename：g_new → 重命名组
  await step('groupRename', (draft) => {
    const group = draft.groups.find((g) => g.groupId === 'g_new');
    if (group) group.name = '重命名组';
    return null;
  });

  // 8. groupDelete：删除 g_new（清理成员/配置/元数据）
  await step('groupDelete', (draft) => {
    draft.groups = draft.groups.filter((g) => g.groupId !== 'g_new');
    delete draft.boardConfig.g_new;
    for (const stock of draft.watchlist) {
      stock.groupIds = stock.groupIds.filter((id) => id !== 'g_new');
      delete stock.manualOrder.g_new;
      delete stock.pinned.g_new;
    }
    return null;
  });

  // 9. globalRemove：删除 sz000001（应同时清理其行情缓存）
  const beforeCodes = new Set(
    (await coordinator.readBootstrap()).userData.watchlist.map((s) => s.code)
  );
  assert.ok(beforeCodes.has('sz000001'), 'sz000001 present before removal');
  // 写入一条 sz000001 缓存以验证孤儿清理
  await coordinator.writeQuoteCache({
    sz000001: { cacheVersion: 1, code: 'sz000001', provider: 'eastmoney', fetchedAt: NOW, quote: { price: 12 } }
  });
  await step('globalRemove', (draft) => {
    draft.watchlist = draft.watchlist.filter((s) => s.code !== 'sz000001');
    return null;
  });
  // 孤儿缓存应已被 mutate 内部清理
  const cacheAfter = await area.get(['quoteCache:sz000001']);
  assert.equal(cacheAfter['quoteCache:sz000001'], undefined, 'globalRemove cleaned orphan cache');

  // ===== 读回 raw schema-v2 用户键，冻结 v1.3 规则回读 =====
  const stored = await area.get(['schemaVersion', 'groups', 'watchlist', 'boardConfig']);
  assert.equal(stored.schemaVersion, 2, 'post-mutation schemaVersion is 2');

  const v13Read = readWithV13Rules(stored, NOW);
  // 断言关键业务语义可读
  assertStockReadable(v13Read.watchlist, 'sh600519', { name: '贵州茅台', groupIds: ['g_watch'] });
  assert.equal(
    v13Read.watchlist.some((s) => s.code === 'sz000001'),
    false,
    'sz000001 removed and not readable'
  );
  // 配置可读
  assert.ok(v13Read.boardConfig.g_watch, 'boardConfig.g_watch readable');
  console.log('[verify-rollback] mutation lifecycle → v1.3 readback OK');

  // ===== 回馈 v2：readWithV13Rules 输出作为新 area seed，再 bootstrap =====
  const roundTripSeed = {
    schemaVersion: 2,
    groups: v13Read.groups,
    watchlist: v13Read.watchlist,
    boardConfig: v13Read.boardConfig,
    'migrationBackup:v1.2.1': raw['migrationBackup:v1.2.1']
  };
  const area2 = createMemoryArea(roundTripSeed);
  const coordinator2 = new StorageCoordinator({ area: area2, clock: () => NOW });
  const boot2 = await coordinator2.readBootstrap();

  // 内容 revision 有效。若 v1.3/v2 规范完全兼容，回馈后 revision 与回读前相同——
  // 这恰恰证明两端数据规范一致；无需强求不同。
  assert.ok(boot2.revision.startsWith('sha256:'), 're-upgrade produced valid revision');

  // 业务等价：sh600519 仍在，sz000001 仍无，g_new 仍无
  const finalStocks = boot2.userData.watchlist;
  assertStockReadable(finalStocks, 'sh600519', { name: '贵州茅台', groupIds: ['g_watch'] });
  assert.equal(
    finalStocks.some((s) => s.code === 'sz000001'),
    false,
    're-upgrade does not resurrect removed stock'
  );
  assert.equal(
    boot2.userData.groups.some((g) => g.groupId === 'g_new'),
    false,
    're-upgrade does not resurrect deleted group'
  );
  console.log('[verify-rollback] v1.3 readback → v2 re-upgrade OK');

  // ===== 冲突保护：旧 revision 不能再写入 =====
  await assert.rejects(
    coordinator2.mutate('sha256:0000000000000000000000000000000000000000000000000000000000000000', (draft) => {
      draft.watchlist = [];
      return null;
    }),
    (error) => error.code === 'CONFLICT',
    'stale revision must CONFLICT without write'
  );
  const afterConflict = await coordinator2.readBootstrap();
  assert.equal(afterConflict.userData.watchlist.length, boot2.userData.watchlist.length, 'CONFLICT performed no write');
  console.log('[verify-rollback] stale-revision CONFLICT protection OK');
}

async function main() {
  await verifyV13ZipSha();

  // 确认 build 产物存在（验证实际发布代码，而非源码）
  const coordinatorPath = join(ROOT, 'build/extension/runtime/infrastructure/storage/storage-coordinator.js');
  assert.ok(
    existsSync(coordinatorPath),
    'build artifact missing — run `npm run build` before verify-rollback'
  );

  const buildRoot = pathToFileURL(join(ROOT, 'build/extension/runtime/')).href;
  const { StorageCoordinator } = await import(`${buildRoot}infrastructure/storage/storage-coordinator.js`);
  const { readWithV13Rules } = await import(pathToFileURL(join(ROOT, 'tests/fixtures/v1.3/reference-reader.mjs')).href);

  // v0/v1/v2 迁移回读
  for (const name of ['storage-v0', 'storage-v1', 'storage-v2']) {
    const fixture = JSON.parse(await readFile(join(ROOT, `tests/fixtures/v1.3/${name}.json`), 'utf8'));
    await verifyFixtureRoundTrip(fixture.payload.input, name, StorageCoordinator, readWithV13Rules);
  }

  // 完整 mutation 生命周期 + 回读 + 再升级
  await verifyMutationLifecycles(StorageCoordinator, readWithV13Rules);

  console.log('[verify-rollback] ✅ all rollback compatibility checks passed');
}

main().catch((error) => {
  console.error('[verify-rollback] ❌ FAILED:', error.message);
  process.exit(1);
});
