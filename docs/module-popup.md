# popup 模块群 — 弹窗 UI

## overview

v1.3.0 将原 popup.js（~1070 行）拆分为 5 个职责清晰的模块，Popup 不再直接访问 Storage / QuoteService，所有数据和存储操作走 RPC 消息总线（`Bridge.send` → `Router`）。

## 模块结构

```
popup.js            — 入口（38 行）：DOMContentLoaded → State.init → Actions.bind → Render.subscribe
popup-bridge.js     — RPC 客户端：Bridge.send(action, payload) → Promise（10s 超时保护）
popup-state.js      — 视图状态管理：subscribe / notify / patch，init 通过 Bridge 加载初始数据
popup-render.js     — DOM 渲染（~748 行）：分组 Tab / 看板 / 网格 / 列表 / Tooltip / Toast / 模态框 / 键盘导航
popup-actions.js    — 用户操作（~579 行）：CRUD / 排序 / 拖拽 / 搜索 / 批量 / 刷新
```

## init 序列

```
DOMContentLoaded
  → State.init()              — Bridge.send('storage:read') + Bridge.send('quote:read') 加载初始数据
  → Actions.bind(State, Render)  — 注入状态和渲染依赖
  → Render.subscribe(State)     — 订阅状态变更
  → Render.renderAll(State.current)
  → Actions.refreshQuotes()     — 首次行情刷新
  → scheduleNextRefresh()       — 自适应定时刷新
```

## architecture_design

### popup-state.js

```
State
├── current            — 全局视图状态对象（groups/watchlist/quotes/viewMode/sortField...）
├── subscribers[]      — 订阅者列表（Render）
├── subscribe(fn)      — 注册订阅
├── notify()           — 通知所有订阅者重新渲染
├── patch(partial)     — 合并更新 current + notify
└── init()             — 通过 Bridge 加载初始数据
```

### popup-render.js

```
Render
├── renderAll(state)              — 全量渲染
├── renderGroupTabs(state)        — 分组栏（role="tablist"，箭头键导航，roving tabindex）
├── renderBoard(state)            — 看板容器
├── renderGrid(state)             — 网格视图（role="button"，Enter/Space 置顶）
├── renderList(state)             — 列表视图（虚拟滚动 >50 只）
├── showQuoteTooltip / hideQuoteTooltip  — 行情悬浮卡
├── toast(msg)                    — 消息提示（role="alert"）
├── _confirm(msg)                 — 自定义确认弹层（role="dialog"）
├── renderColPanel(state)         — 列配置面板
├── esc(str)                      — HTML 转义防 XSS
└── subscribe(state)              — 注册为 State 订阅者
```

### popup-actions.js

```
Actions
├── bind(state, render)           — 注入依赖（typeof document guard 兼容 Node 测试）
├── 行情
│   ├── refreshQuotes()           — Bridge.send('quote:refresh')
│   └── scheduleNextRefresh()     — 盘中 10 秒 / 盘外 5 分钟
├── 分组管理
│   ├── switchGroup / reorderGroups / createGroup / renameGroup / deleteGroup
├── 添加股票
│   ├── openAddModal() / _submitAddStock()
│   ├── renderCodeSuggest / _asyncSearch / _renderSuggestItems
│   └── 搜索防抖 300ms + 序号防竞态
├── 排序与拖拽
│   ├── onSortSelectChange / sortByField / _manualReorder / _rebalanceManualOrder
│   ├── togglePin / _togglePin
│   └── _removeStocks / _submitMove
├── 列配置
│   ├── toggleColumn / reorderColumns / toggleColPanel
│   └── persistBoardPatch (内含 try/catch + toast)
├── 批量模式
│   ├── toggleBatchMode / toggleSelect / openMoveModal
└── 视图
    ├── switchView / togglePriceHidden
```

## tech_stack

- 原生 DOM 操作（无虚拟 DOM、无框架）
- HTML5 Drag and Drop API（卡片 / 行 / 列 / 分组拖拽排序）
- RPC 消息总线：所有数据和存储操作经 `Bridge.send` → `Router` → Service Worker
- QuoteFormat 共享格式化（从 quote-format.js 导入）
- Quotes.searchStocks（仍直接加载 quotes.js 用于搜索联想）
- CSS 设计令牌系统（CSS Custom Properties，WCAG 2.1 AA）
- ARIA 无障碍：tablist / region / dialog / alert / status
- 键盘导航：分组 Tab 箭头键 + 卡片 Enter/Space + `.finally()` 焦点恢复

## coding_conventions

### 代码前缀自动补全规则

```javascript
// _submitAddStock() 中的前缀补全逻辑
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

### RPC 错误处理

所有 Bridge.send 调用包裹在 try/catch 中，失败时 `this.render.toast(e.message || '操作失败，请重试')`。`persistBoardPatch` 有独立的 try/catch（高频操作，避免嵌套）。

### 安全设计

- `esc()` 方法对所有用户可见文本做 HTML 转义（`& < > " '`）
- `_confirm()` 自定义弹层替代 `confirm()`，避免 popup 失焦导致关闭
- popup 关闭时 `beforeunload` 清除定时器

## gotchas_and_constraints

### 搜索过滤正则

所有涉及代码前缀剥离的正则必须包含 `bj`：
```javascript
s.code.replace(/^(sh|sz|bj)/, '')  // 正确
s.code.replace(/^(sh|sz)/, '')     // 错误：会遗漏 bj 前缀
```

### 虚拟滚动

列表超过 50 只股票时，为每个 `.list-row` 添加 `.virtual` 类（`content-visibility: auto`），优化长列表渲染性能。

### WCAG 2.1 AA 合规

- 颜色对比度：所有文本 ≥ 4.5:1，通过 CSS 设计令牌（`--text-primary`、`--text-secondary`、`--color-up`、`--color-down` 等）
- 触控目标：`.header-btn`、`.view-btn`、`.tab-add` ≥ 44px
- `prefers-reduced-motion`：动画降级为即时切换
- 焦点恢复：异步重渲染后通过 `.finally()` 恢复 DOM 元素焦点
