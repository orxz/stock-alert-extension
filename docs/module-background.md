# background.js — Service Worker

## overview

Manifest V3 Service Worker，负责在后台更新扩展图标的 badge 和 tooltip。通过一次性 `chrome.alarms` 按自适应间隔（盘中 30 秒 / 盘外 5 分钟）刷新行情，使用 `QuoteService` 的缓存感知结果展示真实状态。

## architecture_design

```
background.js
├── importScripts('stock-utils.js', 'storage.js', 'quotes.js', 'quote-format.js', 'quote-service.js', 'router.js')
├── Router.init(QuoteService, Storage)  — 初始化 RPC 路由器（v1.3.0）
├── updateBadgeAndTitle()       — 核心更新逻辑
├── scheduleNextAlarm()         — 一次性 alarm（盘中 30 秒 / 盘外 5 分钟）
├── chrome.runtime.onInstalled  — 安装时初始化
├── chrome.runtime.onStartup    — 浏览器启动时初始化
└── chrome.storage.onChanged    — 数据变更即时更新

formatBadge / formatBadgeState / formatTooltipLine
  → 从 quote-format.js 导入（v1.3.0 提取为共享模块）
```

## data_flow

### 更新流程

```
触发源（alarms / onInstalled / onStartup / storage.onChanged）
  ↓
updateBadgeAndTitle()
  ↓
重入保护检查（_updating / _pending）
  ↓
Storage.loadAll() → 读取 watchlist
  ↓
StockUtils.getStocksForGroup(watchlist, g_all) → 计算视图
StockUtils.sortStocks(...) → 按当前看板排序
quote 字段排序先取全部行情；manual/name/addedAt 排序只取前 5 只
  ↓
QuoteService.read(codes) → 先渲染缓存
QuoteService.refresh(codes) → 网络刷新后重渲染
  ↓
Badge：涨跌幅绝对值（无+号）+ 红绿背景
  实时：红 #E74C3C（涨）/ 绿 #27AE60（跌）/ 灰 #95A5A6（平）
  缓存/缺失：灰 #95A5A6（缓存保留数字，缺失显示 --）
Tooltip：名称 + 涨跌箭头（▲▼—）+ 涨跌幅
```

## gotchas_and_constraints

### 重入保护

alarms 和 storage.onChanged 可能同时触发 `updateBadgeAndTitle()`，导致并发问题。使用 `_updating`（互斥锁）+ `_pending`（待重试标记）：

```javascript
if (_updating) { _pending = true; return; }
// ... 执行更新 ...
if (_pending) { _pending = false; updateBadgeAndTitle(); } // 补偿更新
```

### Badge 字符限制

Chrome badge 最多 4 个字符。`formatBadge()` 策略：
- ≥1000% → `999`
- ≥100% → 整数（如 `105`）
- ≥10% → 无小数（如 `12`）
- <10% → 1 位小数（如 `2.5`）

不带 `+` 号，通过红/绿背景色判断涨跌方向。

### Tooltip 格式

名称截断为 6 个字符，涨跌幅保留 1 位小数 + `%`，涨跌方向用 `▲`/`▼`/`—` 箭头。

### 自适应调度

Manifest V3 中 `chrome.alarms` 是后台定时器的唯一可靠方式（`setInterval` 在 Service Worker 中会被回收）。每次更新完成后按 `QuoteService.getRefreshIntervalMs(now, 'background')` 创建一次性 alarm：盘中 30 秒、盘外 5 分钟。

### 缓存与缺失状态

行情来自缓存时 badge 保留数字但使用灰色，tooltip 追加「已过期 HH:MM」；无任何可用行情时 badge 显示灰色 `--`，title 显示「暂无可用行情」，避免残留旧的红色/绿色。

## coding_conventions

- 颜色惯例：红涨绿跌（中国股市标准），与欧美市场相反
- Service Worker 中通过 `importScripts()` 导入 stock-utils.js / storage.js / quotes.js / quote-format.js / quote-service.js / router.js
- 所有 chrome API 调用不检查错误（fire-and-forget），异常由 try-catch 捕获后 console.warn
