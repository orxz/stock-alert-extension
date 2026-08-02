# background.js — Service Worker

## overview

Manifest V3 Service Worker，负责在后台更新扩展图标的 badge 和 tooltip。通过一次性 `chrome.alarms` 按自适应间隔（盘中 30 秒 / 盘外 5 分钟）刷新行情，使用 `QuoteService` 的缓存感知结果展示真实状态。

## architecture_design

```
background.js
├── importScripts('stock-utils.js', 'storage.js', 'quotes.js', 'quote-service.js', 'quote-format.js', 'router.js')
├── getBackgroundStorage()      — 懒初始化带 onDiagnostic 钩子的存储实例（v1.3.0+）
├── getBackgroundQuoteService()  — 懒初始化带 onDiagnostic 钩子的行情实例（v1.3.0+）
├── Router.init(service, storage) — 初始化 RPC 路由器
├── updateBadgeAndTitle(source)  — 核心更新逻辑（source 标注触发来源）
├── scheduleNextAlarm()         — 一次性 alarm（盘中 30 秒 / 盘外 5 分钟）
├── chrome.runtime.onInstalled  — 安装时初始化
├── chrome.runtime.onStartup    — 浏览器启动时初始化
└── chrome.storage.onChanged    — 数据变更即时更新

可观测性三段诊断（v1.3.0+）：
├── trigger:   emitDiagnostic(runId, 'trigger', {type:'run-start', trigger, startedAt})
├── boundary:  QuoteService/Storage 的 onDiagnostic 事件（provider-failed / cache-*-failed / ...）
└── recovery:  emitDiagnostic(runId, 'result', {type:'run-end', outcome, counts, durationMs})

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

alarms 和 storage.onChanged 可能同时触发 `updateBadgeAndTitle()`，导致并发问题。使用 `updating`（互斥锁）+ `pending`（待重试标记）：

```javascript
if (updating) { pending = true; return; }
// ... 执行更新（设置 activeRun 共享 runId）...
if (pending) { pending = false; updateBadgeAndTitle('retry'); } // 补偿更新
```

### 可观测性诊断框架

`updateBadgeAndTitle` 通过共享 `runId` 将三段链路关联到 console：

1. **触发段**（trigger）：`run-start` 事件标注触发来源（`installed` / `startup` / `alarm` / `storage-change` / `retry`）
2. **边界段**（boundary）：QuoteService 和 Storage 通过注入的 `onDiagnostic` 钩子发出结构化事件：
   - QuoteService: `provider-failed`（含 provider 名、错误分类、codeCount）、`refresh-empty`、`refresh-deferred`、`refresh-done`（含 counts/failureCount/nextRetryAt）
   - Storage: `cache-read-failed` / `cache-write-failed` / `cache-delete-failed`（含 codes 与 error 文本，rethrow 原错误）
3. **恢复段**（recovery）：`run-end` 事件标注结果（`outcome: ok|failed`）和耗时

`runId` 格式为 `r-<timestamp>-<counter>`，保证跨段可关联。诊断事件通过 `console.log`（正常）或 `console.warn`（含 error 字段时）输出。

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
- Service Worker 中通过 `importScripts()` 导入 stock-utils.js / storage.js / quotes.js / quote-service.js / quote-format.js / router.js
- 所有 chrome API 调用不检查错误（fire-and-forget），异常由 try-catch 捕获后 console.warn
