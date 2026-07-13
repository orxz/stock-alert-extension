# storage.js — 本地存储层

## overview

封装 `chrome.storage.local` 的读写操作，管理分组、自选股、看板配置三类数据。提供数据迁移能力（旧版扁平列表 → 分组结构）。

## architecture_design

核心对象 `Storage`，单例模式。

```
Storage
├── loadAll()                          — 读取全部数据（含迁移逻辑）
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
```

## data_model

### chrome.storage.local 键

| Key | 类型 | 说明 |
|-----|------|------|
| groups | Array | 分组列表 |
| watchlist | Array | 自选股列表 |
| boardConfig | Object | 各分组看板配置（按 groupId 索引） |
| watchlist_legacy | Array | 旧版扁平列表（迁移用） |

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
  groupIds: ['g_all'],    // 所属分组 ID 列表
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

`g_all`（「全部」）是系统默认分组，`deleteGroup` 会抛出错误。删除普通分组时，组内股票移回 `g_all`。

### 置顶数据清理

取消置顶时删除 key 而非置 `false`（`delete stock.pinned[groupId]`），当 `pinned` 变为空对象时整体 `delete`，避免数据残留膨胀。

### 批量操作优化

`removeStocksBatch` 一次读写完成批量删除，避免逐条 `await` 的性能问题。`deleteGroup` 一次性保存 groups + watchlist + boardConfig 三个变更。

### 数据迁移

`loadAll()` 检测 `watchlist_legacy` 键，如存在旧版扁平列表则自动迁移为分组结构。迁移是一次性的，完成后写入新结构。

## coding_conventions

- 常量：`DEFAULT_GROUP_ID = 'g_all'`、`MAX_GROUPS = 20`
- 所有写操作先 `loadAll()` 读最新数据再修改，避免并发覆盖
- `addStock` 如已存在则仅追加 groupIds，不重复添加
- 移出非默认分组时清零该分组的 `manualOrder` 和 `pinned`
