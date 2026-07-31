# storage.js — 本地存储层

## overview

封装 `chrome.storage.local` 的读写操作，管理分组、自选股、看板配置与行情缓存四类数据。提供 schema v2 数据迁移（旧版扁平列表 → 分组结构）、串行写入队列（避免并发 lost-update）和按代码隔离的行情缓存。

## architecture_design

核心对象 `Storage`，单例模式。

```
Storage
├── loadAll()                          — 读取全部数据（schema v2 迁移/清洗）
├── saveGroups / saveWatchlist / saveBoardConfig
├── 分组操作
│   ├── createGroup(name)              — 新建（上限 20）
│   ├── renameGroup(groupId, name)
│   ├── deleteGroup(groupId)           — 组内股票移回「全部」
│   └── reorderGroups(newOrderIds)     — 拖拽排序
├── 自选股操作
│   ├── addStock(code, name, groupIds)
│   ├── removeStock / removeStocksBatch
│   ├── moveStocksToGroups(codes, from, targets)
│   ├── setManualOrder(groupId, ids)   — 拖拽排序持久化
│   └── togglePin(groupId, code)       — 置顶/取消置顶
└── 看板配置
    ├── getBoardConfig(groupId)        — 读取（含默认值）
    └── saveBoardConfigForGroup(groupId, cfg)
└── 行情缓存
    ├── readQuoteCache(codes)          — 读取按代码隔离的缓存条目
    ├── writeQuoteCache(entries)       — 写入缓存条目
    └── deleteQuoteCache(codes)        — 删除缓存条目
```

## data_model

### chrome.storage.local 键

| Key | 类型 | 说明 |
|-----|------|------|
| groups | Array | 分组列表 |
| watchlist | Array | 自选股列表 |
| boardConfig | Object | 各分组看板配置（按 groupId 索引） |
| schemaVersion | Number | 当前 schema 版本（2） |
| watchlist_legacy | Array | 旧版扁平列表（迁移用，迁移后仅保留备份） |
| migrationBackup:v1.2.1 | Object | 迁移前原始数据的一次性本地备份 |
| quoteCache:{code} | Object | 单只股票的行情缓存（独立键） |

### 分组对象

```javascript
{
  groupId: 'g_all',       // 'g_' + timestamp，默认组为 'g_all'
  name: '全部',
  order: 0,               // 排序序号
  isDefault: true,        // 默认组不可删除
  createdAt: number,
  updatedAt: number
}
```

### 自选股对象

```javascript
{
  code: 'sh600519',       // 带前缀的股票代码
  name: '贵州茅台',
  groupIds: ['g_tech'],   // 仅自定义分组 ID；g_all 为计算视图，不存储
  manualOrder: { g_all: 0 }, // 各分组内的手动排序
  pinned: { g_all: true },   // 各分组内的置顶状态
  addedAt: number
}
```

### 看板配置

```javascript
{
  viewMode: 'grid',       // 'grid' | 'list'
  sortField: 'manual',    // manual | price | changePercent | ...
  sortDirection: 'desc',  // asc | desc
  columns: ['name', 'price', 'change', 'changePercent'],
  columnOrder: ['name', 'price', 'change', 'changePercent']
}
```

## gotchas_and_constraints

### 默认分组不可删除

`g_all`（「全部」）是系统默认分组，`deleteGroup` 会抛出错误。`g_all` 是完整自选股的计算视图，不要求任何股票带有 `g_all` 成员关系。

### 置顶数据清理

取消置顶时删除 key 而非置 `false`（`delete stock.pinned[groupId]`），当 `pinned` 变为空对象时整体 `delete`，避免数据残留膨胀。

### 批量操作优化

`removeStocksBatch` 一次读写完成批量删除，避免逐条 `await` 的性能问题。`deleteGroup` 一次性保存 groups + watchlist + boardConfig 三个变更。

### 数据迁移（v0/v1 → v2）

`loadAll()` 在 `schemaVersion !== 2` 时执行 `migrateToV2`：先写入 `migrationBackup:v1.2.1` 备份，再把旧版 `watchlist`/`watchlist_legacy` 规范化合并（代码规范化、重复合并、移除 `g_all` 成员关系、清理未知分组 ID），最后一次性写入 v2 结构。迁移幂等，重复执行不会覆盖原备份。

### 串行写入

所有用户数据修改（含三个原子保存方法）都经 `mutateUserData` 的串行队列执行：先读最新数据 → 变更单个字段 → 回写四个核心键，避免并发读改写丢失更新。

### 行情缓存

缓存键为 `quoteCache:{code}`，与用户数据分离；`readQuoteCache` 只接受 `cacheVersion === 1` 且字段完整的条目，损坏条目自动忽略；删除自选股时同步删除对应缓存键。

## coding_conventions

- 常量：`DEFAULT_GROUP_ID = 'g_all'`、`MAX_GROUPS = 20`
- 所有写操作经串行队列执行，避免并发覆盖
- schema v2：从「全部」添加不存分组 ID；从自定义分组添加存该 ID；移动到「全部」只移除源 ID
- `addStock` 如已存在则仅追加 groupIds，不重复添加
- 移出非默认分组时清零该分组的 `manualOrder` 和 `pinned`
