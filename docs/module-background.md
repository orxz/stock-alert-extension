# background.js — Service Worker

## overview

Manifest V3 Service Worker，负责在后台定期更新扩展图标的 badge 和 tooltip。通过 `chrome.alarms` 每 30 秒刷新行情数据，显示置顶股票的涨跌幅。

## architecture_design

```
background.js
├── importScripts('storage.js', 'quotes.js')  — 导入依赖
├── formatBadge(percent)        — 格式化 badge 文字
├── formatTooltipLine(stock, quote) — 格式化 tooltip 单行
├── updateBadgeAndTitle()       — 核心更新逻辑
├── chrome.alarms               — 30 秒定时器
├── chrome.runtime.onInstalled  — 安装时初始化
├── chrome.runtime.onStartup    — 浏览器启动时初始化
└── chrome.storage.onChanged    — 数据变更即时更新
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
确定 badge 股票：置顶 > 第一只
确定 tooltip 股票：置顶排前 + 其余，取前 5 只
  ↓
Quotes.fetch(codes) → 获取行情
  ↓
Badge：涨跌幅绝对值（无+号）+ 红绿背景
  红 #E74C3C（涨）/ 绿 #27AE60（跌）/ 灰 #95A5A6（平）
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

### alarms 权限

Manifest V3 中 `chrome.alarms` 是后台定时器的唯一可靠方式（`setInterval` 在 Service Worker 中会被回收）。最小间隔 0.5 分钟（30 秒）。

## coding_conventions

- 颜色惯例：红涨绿跌（中国股市标准），与欧美市场相反
- Service Worker 中通过 `importScripts()` 导入 storage.js 和 quotes.js
- 所有 chrome API 调用不检查错误（fire-and-forget），异常由 try-catch 捕获后 console.warn
