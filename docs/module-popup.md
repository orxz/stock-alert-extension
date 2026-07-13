# popup.js — 主交互逻辑

## overview

弹窗 UI 的核心控制器，负责分组管理、看板渲染、排序拖拽、列配置、模态框等全部前端交互逻辑。约 1070 行代码，是项目最大的模块。

## architecture_design

核心对象 `App`，单例模式，`DOMContentLoaded` 时调用 `App.init()` 启动。

```
App
├── state                — 全局状态（groups/watchlist/quotes/viewMode...）
├── HOT_STOCKS           — 预设热门股票库（含拼音/行业标签）
├── init()               — 初始化 + 启动 10 秒定时刷新
├── 行情
│   ├── refreshQuotes()  — 调用 Quotes.fetch()
│   └── updateDataSourceLabel()
├── 分组管理
│   ├── renderGroupTabs()
│   ├── openGroupModal / submitGroupModal / deleteGroup
│   └── reorderGroups / switchGroup
├── 添加股票
│   ├── openAddModal()
│   ├── renderCodeSuggest / _asyncSearch / _renderSuggestItems
│   └── submitAddStock() — 前缀自动补全 + 校验
├── 看板渲染
│   ├── getGroupStocks() — 过滤 + 搜索 + 排序
│   ├── renderBoard() / renderGrid() / renderList()
│   └── showQuoteTooltip / hideQuoteTooltip
├── 排序与拖拽
│   ├── onSortSelectChange / sortByField / manualReorder
│   └── togglePin
├── 列配置
│   ├── toggleColPanel / renderColPanel
│   └── toggleColumn / reorderColumns
├── 批量模式
│   └── toggleBatchMode / toggleSelect / openMoveModal / submitMove
└── 工具方法
    ├── esc() — HTML 转义防 XSS
    ├── toast() — 消息提示
    └── _confirm() — 自定义确认弹层
```

## tech_stack

- 原生 DOM 操作（无虚拟 DOM、无框架）
- HTML5 Drag and Drop API（卡片/行/列/分组拖拽排序）
- setInterval 10 秒定时刷新行情
- 自定义防抖（配置保存 200ms、搜索 300ms）

## coding_conventions

### 代码前缀自动补全规则

```javascript
// submitAddStock() 中的前缀补全逻辑
if (/^(4|8|9)/.test(code)) code = 'bj' + code;      // 北交所
else if (/^(6|5|11|12|13)/.test(code)) code = 'sh' + code; // 沪市
else code = 'sz' + code;                              // 深市

// 校验：/^(sh|sz|bj)\d{6}$/
```

### 搜索防抖 + 序号机制

```javascript
_searchSeq: 0  // 全局递增序号

// 每次发起新搜索时 ++_searchSeq
// 异步结果返回后检查 seq !== this._searchSeq 则丢弃（旧请求）
```

### 配置写入防抖

```javascript
_scheduleBoardSave(groupId, cfg)  // 200ms 内多次调用合并为一次写入
_flushBoardSave()                  // 按分组隔离写入，避免跨组 IO
```

### 安全设计

- `esc()` 方法对所有用户可见文本做 HTML 转义（`& < > " '`）
- `_confirm()` 自定义弹层替代 `confirm()`，避免 popup 失焦导致关闭
- popup 关闭时 `beforeunload` 清除定时器 + flush 待保存配置

## gotchas_and_constraints

### 搜索过滤正则

所有涉及代码前缀剥离的正则必须包含 `bj`：
```javascript
s.code.replace(/^(sh|sz|bj)/, '')  // 正确
s.code.replace(/^(sh|sz)/, '')     // 错误：会遗漏 bj 前缀
```

### 虚拟滚动

列表超过 50 只股票时，为每个 `.list-row` 添加 `.virtual` 类（`content-visibility: auto`），优化长列表渲染性能。

### HOT_STOCKS 预设库

包含 40 只热门股票（沪市 19 + 深市 12 + 科创板 5 + 北交所 3 + 创业板 1），每只含 code/name/tag/pinyin 四个字段，用于：
1. 添加弹窗空输入时展示热门
2. API 搜索失败时的本地降级匹配
3. 看板搜索的拼音/行业标签元数据查找
