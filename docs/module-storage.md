# 基础设施存储层（src/infrastructure/storage）

## overview

本地存储基础设施层，封装 `chrome.storage.local` 的读写，管理分组、自选股、看板配置与行情缓存四类数据。v2.0.0 起由 8 个 TypeScript 文件组成，分层为：`StorageArea` 接口 → `ChromeStorageAdapter` 适配 → `StorageCoordinator` 单一协调器（唯一读写队列）→ `UserDataRepository` / `QuoteCacheRepository` 薄能力包装。

核心设计：所有存储操作串行化在单一 Promise tail 上，避免 MV3 Service Worker 重启与并发读改写导致的 lost-update；`mutate` 通过 SHA-256 内容摘要（`userDataRevision`）实现乐观并发控制；schema v2 数据结构不变，`g_all` 仍为计算视图。

## architecture_design

### 分层与文件

```
src/infrastructure/storage/
├── storage-area.ts            — StorageArea 接口（get/set/remove 三原语，深拷贝语义）
├── chrome-storage-adapter.ts  — 生产适配器，委托 chrome.storage.local；工厂 createChromeStorageArea()
├── storage-coordinator.ts     — 单一协调器，拥有唯一读写队列与读/写临界区
├── user-data-repository.ts    — UserDataRepositoryImpl 薄包装，转调 Coordinator
├── quote-cache-repository.ts  — QuoteCacheRepositoryImpl 薄包装，转调 Coordinator
├── sanitize-v2.ts             — schema v2 幂等清洗（纯函数）
├── migration-service.ts       — v0/v1 → v2 幂等迁移，保留首次备份
└── user-data-revision.ts      — SHA-256 内容摘要（乐观并发基线）
```

端口接口定义在 `src/application/ports/storage.ts`（`UserDataRepository` / `QuoteCacheRepository` / `BootstrapStorageSnapshot` / `MutableUserData`），只依赖 domain/protocol，不引用 infrastructure。

### StorageArea 接口

最小抽象，封装 `chrome.storage.local` 的 `get / set / remove` 三个原语。约定返回值均为深拷贝（`structuredClone` 语义），调用方可安全修改。生产由 `ChromeStorageAdapter` 实现，测试由 `MemoryStorageArea` 实现。

### StorageCoordinator —— 唯一读写队列

核心对象，单例。所有 6 个公共方法通过 `enqueue(task)` 追加到单一 Promise tail，串行执行，无并发读改写：

```
StorageCoordinator
├── readBootstrap()                 — 读临界区：读 raw → 迁移（若需）→ sanitize →
│                                     digest → 冻结 code 集 → 批量读 cache → 清理孤儿
├── mutate(rev, change)             — 写临界区：重读 → digest 比对 → CONFLICT →
│                                     structuredClone draft → change(draft) → sanitize →
│                                     写三键 → 删除被移除 code 的 cache → 返回 {value, userData, revision}
├── readQuoteCache(codes)           — 批量读缓存（只读，走队列保证一致性快照）
├── writeQuoteCache(entries)        — 写入前重检 code 是否仍在 watchlist（防孤儿）
├── deleteQuoteCache(codes)         — 批量删除缓存键
└── reconcileOrphanQuoteCache()     — 扫描 quoteCache:* 键，删除不在 watchlist 中的
```

**读临界区**（`readBootstrap`）：跨迁移、清洗、摘要计算和缓存批量读取，一次性返回冷启动快照 `{ userData, revision, quoteCache }`。

**写临界区**（`mutate`）：基于 `expectedRevision` 的乐观并发控制——重新读最新 userData → 重新计算 digest 比对 → 不匹配则抛 `AppError(CONFLICT)`（retryable）→ 匹配则 `structuredClone` 出可变 draft → 执行 `change(draft)` → `sanitizeV2` 清洗 → 计算 `newRevision` → 写 `groups/watchlist/boardConfig`（连 `schemaVersion:2`）→ 删除被移除 codes 的 `quoteCache:*` 键 → 返回 `{ value, userData, revision }`。

### Repository 薄包装

`UserDataRepositoryImpl` 与 `QuoteCacheRepositoryImpl` 仅接收同一 `Coordinator` 实例并转调其方法，自身不含队列、不持有 `StorageArea`。并发控制完全由 Coordinator 的单队列保证——两个 Repository 共享队列，因此用户数据修改与缓存写入天然互斥，不会产生孤儿缓存。

### sanitizeV2 与 migrateToV2

- `sanitizeV2(raw, now)`（纯函数）：将任意 raw 输入规范化为合法 `UserData`。分组固定 `g_all` 为首位默认组、自定义组去重最多 19 个并重排 order；watchlist 经 `normalizeStockCode` 规范化、丢弃非法、移除 `g_all` 成员关系、按 code 合并重复；boardConfig 浅拷贝保留无关字段。不调用 `Date.now()` / chrome / 副作用。
- `migrateToV2(area, raw, now)`（幂等）：首次执行时写入 `migrationBackup:v1.2.1` 一次性备份（不覆盖已有）；v0 扁平列表从 `watchlist_legacy` 还原；最终 `sanitizeV2` 清洗并持久化 v2 结构。重复执行不会覆盖原备份。

### computeUserDataRevision

`UserData` 内容摘要（`sha256:<hex>`）：对 `{ groups, watchlist, boardConfig }` 做规范化 JSON（递归排序键）后 SHA-256。`schemaVersion` 不参与摘要（始终为 2）。基于 Web Crypto API（`globalThis.crypto.subtle.digest`），Node 18+ 与浏览器通用。用于 `mutate` 的乐观并发比对。

## data_model

### chrome.storage.local 键

| Key | 类型 | 说明 |
|-----|------|------|
| groups | Array | 分组列表 |
| watchlist | Array | 自选股列表 |
| boardConfig | Object | 各分组看板配置（按 groupId 索引） |
| schemaVersion | Number | 当前 schema 版本（固定 2） |
| watchlist_legacy | Array | 旧版扁平列表（v0 迁移源；迁移后保留） |
| migrationBackup:v1.2.1 | Object | 迁移前原始数据的一次性本地备份（首次写入不覆盖） |
| quoteCache:<code> | Object | 单只股票的行情缓存（独立键，`cacheVersion:1`） |

### 分组对象

```typescript
{
  groupId: 'g_all',       // 'g_all' 固定首位默认组；自定义组 'g_' + 标识
  name: '全部',
  order: 0,               // 默认组 0；自定义组 1..19
  isDefault: true,        // 默认组不可删除
  createdAt: number,
  updatedAt: number
}
```

### 自选股对象

```typescript
{
  code: 'sh600519',         // normalizeStockCode 规范化的带前缀代码
  name: '贵州茅台',
  groupIds: ['g_tech'],     // 仅自定义分组 ID；g_all 为计算视图，不存储
  manualOrder: { g_all: 0 },// 各分组内的手动排序
  pinned: { g_all: true },  // 各分组内的置顶状态
  addedAt: number
}
```

### 看板配置

```typescript
{
  viewMode: 'grid',         // 'grid' | 'list'
  sortField: 'manual',      // manual | price | changePercent | ...
  sortDirection: 'desc',    // asc | desc
  columns: ['name', 'price', 'change', 'changePercent'],
  columnOrder: ['name', 'price', 'change', 'changePercent']
}
```

## gotchas_and_constraints

### 默认分组不可删除

`g_all`（「全部」）是系统默认分组，固定 `order:0`、`isDefault:true`，是完整自选股的计算视图——不要求任何股票带有 `g_all` 成员关系，`sanitizeV2` 会主动从 `groupIds` 中移除 `g_all`。

### 置顶数据清理

取消置顶时删除 key 而非置 `false`（`delete stock.pinned[groupId]`），当 `pinned` 变为空对象时整体 `delete`，避免数据残留膨胀。

### 单队列串行化

所有 6 个操作（含 `readBootstrap` 与 `mutate`）均经 `enqueue` 排在同一 Promise tail 上串行执行。`UserDataRepository` 与 `QuoteCacheRepository` 共享同一 Coordinator，因此 delete-watchlist 与 late-writeQuoteCache 并发时缓存不会被孤立。

### 乐观并发控制

`mutate` 以 `expectedRevision`（`sha256:<hex>`）为基线：重新读最新 userData 并重算 digest，与期望值不匹配则抛 `AppError(CONFLICT)`（`retryable:true`），不写入。调用方（RPC 处理器）应捕获后回读最新 revision 重试。

### 孤儿缓存清理

缓存与用户数据分离存储。三重防孤儿机制：`mutate` 写回后删除被移除 code 的 `quoteCache:*` 键；`writeQuoteCache` 写入前重检 code 是否仍在 watchlist；`readBootstrap` 冷启动时调用 `reconcileOrphanQuoteCache` 扫描全部 `quoteCache:*` 键删除非成员条目。

### 行情缓存校验

`readCacheInternal` 只接受 `cacheVersion === 1` 且 `code` 与请求键匹配、`fetchedAt` 有限、`quote` 为非空对象的条目；损坏条目自动忽略，不抛错。

### 数据迁移（v0/v1 → v2）

`loadUserData` 在 `schemaVersion !== 2` 时调用 `migrateToV2`：先写 `migrationBackup:v1.2.1` 一次性备份（不覆盖），再从 `watchlist` / `watchlist_legacy` 还原并规范化合并，最后 `sanitizeV2` 清洗并持久化 v2 结构。迁移幂等，重复执行不覆盖原备份。

## coding_conventions

- 常量：`DEFAULT_GROUP_ID = 'g_all'`、`DEFAULT_GROUP_NAME = '全部'`、`MAX_GROUPS = 20`、`SCHEMA_VERSION = 2`、`MIGRATION_BACKUP_KEY = 'migrationBackup:v1.2.1'`、`QUOTE_CACHE_PREFIX = 'quoteCache:'`
- 所有读写经 `StorageCoordinator.enqueue` 串行队列执行，避免并发覆盖
- schema v2：从「全部」添加不存分组 ID；从自定义分组添加存该 ID；移动到「全部」只移除源 ID
- `mutate` 回调修改 draft 时对单只股票须整体替换：`draft.watchlist[i] = { ...draft.watchlist[i], groupIds: [...] }`
- revision 为 `UserData` 的 SHA-256 内容摘要（`schemaVersion` 不参与），用作乐观并发基线
- `sanitizeV2` 与 `computeUserDataRevision` 为纯函数（无 `Date.now()` / chrome / 副作用），`now` 由调用方通过 `clock` 注入
- `StorageArea` 返回值约定为深拷贝语义；测试用 `MemoryStorageArea`，生产用 `ChromeStorageAdapter`
