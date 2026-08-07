# 股票提醒助手 — 功能说明书与 API 集成指南

> 版本：v2.0.1 ｜ 平台：Chrome 浏览器扩展（Manifest V3） ｜ 文档更新日期：2026-08-07
>
> 本文档是面向开发者的功能规格与 API 集成指南。整体架构概览见 [项目架构.md](项目架构.md)；开发规范唯一权威见根目录 [AGENTS.md](../AGENTS.md)；行情模块的 provider 实现细节见 [module-quotes.md](module-quotes.md)。

---

## 1. 文档概述

本文档涵盖插件的功能规格、数据模型、存储结构、外部 API 集成细节（东方财富行情 API、东方财富搜索 API、腾讯行情 API）、行情缓存与降级机制、安全与权限设计。

本文档基于 v2 分层 TypeScript 架构（Domain / Protocol / Application / Infrastructure / Background / Popup）编写，所有代码引用均可追溯至 `src/` 下对应模块。

---

## 2. 插件概述

### 2.1 基本信息

「股票提醒助手」是一款基于 Chrome Manifest V3 的浏览器扩展，为用户提供自选股分组管理、实时行情看板、智能搜索补全和后台 Badge/Tooltip 功能。插件不使用任何远程代码，所有逻辑均在本地执行。

- **版本**：v2.0.1
- **Manifest 版本**：V3
- **权限**：`storage`、`alarms`
- **主机权限**：`https://push2.eastmoney.com/*`、`https://searchapi.eastmoney.com/*`、`https://qt.gtimg.cn/*`
- **CSP 策略**：`script-src 'self'; object-src 'self'`
- **涨跌色惯例**：红色 = 涨（`#E74C3C`），绿色 = 跌（`#27AE60`），灰色 = 平（`#95A5A6`）

> **产品名说明**：「股票提醒助手」仅为产品名，本扩展**没有价格提醒功能**。

### 2.2 架构设计

v2.0.0 将 v1 时代的扁平 JS 脚本架构重构为分层 TypeScript 架构。详见 [项目架构.md](项目架构.md) 的完整分层图与数据流。核心分层：

```
Presentation (Popup)  →  Application (Commands/Services/Ports)  →  Domain (Models/Rules/Errors)
Infrastructure (Chrome/Storage/HTTP)  →  implements  →  Application Ports
```

- Popup 与 Service Worker 通过 RPC v2（`chrome.runtime.sendMessage`，10s 超时）通信
- 行情编排和搜索只发生在 Service Worker
- 所有存储读写经 `StorageCoordinator` 单一串行队列

### 2.3 源码结构

```
src/
├── domain/        — 领域模型（Stock/Group/Quote/BoardConfig + 规则 + 格式化），纯 ES2022
├── protocol/      — RPC v2 单一注册表（13 方法 / payload / result / 校验器）
├── application/   — 用例（Bootstrap / PortfolioCommands / QuoteService / SearchService）+ Ports
├── infrastructure/— Chrome Storage 适配器 + StorageCoordinator + Quote/Search Providers
├── background/    — SW 组合根：listener 注册 + 初始化屏障 + Router + Scheduler + Badge
└── popup/         — 不可变 Store + Reducer + Commands + Light DOM Web Components
```

完整文件结构见 [项目架构.md](项目架构.md#文件结构)。

---

## 3. 功能规格

### 3.1 自选股分组管理

支持多分组管理自选股，默认提供「全部」分组（`g_all`，计算视图），用户可创建最多 **19 个自定义分组**（+1 默认 = `MAX_GROUPS = 20`）。

**分组操作**（经 RPC v2 写命令，携带 `expectedRevision` 乐观并发控制）：

- **创建分组**：`group:create`，校验分组名唯一性和数量上限
- **重命名分组**：`group:rename`，校验名称不冲突
- **删除分组**：`group:delete`，默认分组不可删除；删除当前分组自动回退「全部」
- **重排序分组**：`group:setOrder`

**自选股操作**：

- **添加股票**：`stock:add` — 若已存在则合并分组关系，否则创建新记录
- **移除股票**：`stock:remove`
- **移动股票**：`stock:move`
- **置顶**：`stock:setPinned`
- **手动排序**：`stock:setOrder`

### 3.2 实时行情看板

**双视图**：网格卡片 / 数据列表，每分组独立保存配置（`boardConfig`）。

**默认形态**：全新用户打开即 **深色 + 网格**。

**自动刷新**：

- 弹窗：盘中 10 秒 / 盘外 5 分钟（递归 setTimeout）
- 后台：盘中 30 秒 / 盘外 5 分钟（一次性 alarm）

**行情三态**：

| 状态 | 样式 | 含义 |
|------|------|------|
| 实时（fresh） | 红涨绿跌 | 30 秒内从行情源获取 |
| 缓存（cached） | 灰色 + 旧 HH:MM | 行情源暂不可用，展示 7 天内的本地缓存 |
| 缺失（missing） | 灰色 `--` | 无可用数据（停牌、缓存超 7 天或损坏） |

状态栏汇总显示「实时 N · 缓存 M」。**绝不生成模拟价格**。

### 3.3 详情面板（v2.0.1）

悬停列表行 / 卡片，详情数据从 5 项扩展到 **16 项**双栏布局：

现价、涨跌额、涨跌幅、今开、昨收、最高、最低、成交量、成交额、换手率、振幅、量比、市盈率、市净率、总市值、流通市值、涨停价、跌停价。

### 3.4 搜索与添加股票

- **搜索补全**：300ms 防抖，调用东方财富搜索 API；API 失败时降级到本地股票目录
- **搜索序号机制**：generation 防止旧请求覆盖新结果
- **市场前缀自动识别**：`sh` / `sz` / `bj`，经 `normalizeStockCode` 规范化

### 3.5 列配置

列表视图可选 **5 个可配置列**（名称列固定显示、不进入设置面板）。v2.0.1 修复：列设置面板中代码 / 状态是名称列副标题（↑↓ 禁用、固定尾部），主列排序实时生效。卡片视图也按列设置显隐字段。

### 3.6 管理持仓（原「多选」）

v2.0.1 改名「管理持仓」——该模式的出口是全选 / 移动到分组 / 移除。批量工具栏支持：全选、移动到分组、移除。

### 3.7 其他功能

- **排序**：手动 / 涨跌幅 / 价格 / 成交额 / 自选时间，置顶与拖拽互不干扰
- **价格隐藏**：投屏友好，价格类字段掩码 `****`
- **虚拟滚动**：列表超过 50 只时启用 `content-visibility: auto`
- **成交额单位以亿为主**：≥100 万为「X.X亿」，<100 万回退「X万」

### 3.8 Badge 与 Tooltip

后台 Service Worker 更新扩展图标：

- **Badge**：显示排序第一只股票的涨跌幅（红涨绿跌，缓存灰显）
- **Tooltip**：前 5 只股票（名称 + 涨跌箭头 + 涨跌幅，缓存附「已过期 HH:MM」）

---

## 4. 数据模型与存储

### 4.1 schema v2

所有数据存储在 `chrome.storage.local`，经 `StorageCoordinator` 单一串行队列读写。详见 [module-storage.md](module-storage.md)。

| Key | 类型 | 说明 |
|-----|------|------|
| `groups` | Array | 分组列表（`g_all` 固定首位 + 自定义组） |
| `watchlist` | Array | 自选股列表 |
| `boardConfig` | Object | 各分组看板配置（按 groupId 索引） |
| `schemaVersion` | Number | 固定 2 |
| `quoteCache:<code>` | Object | 单只股票行情缓存（独立键，`cacheVersion:1`） |
| `migrationBackup:v1.2.1` | Object | 迁移前一次性备份（不覆盖） |

### 4.2 乐观并发控制

`userDataRevision` 是规范化 `groups + watchlist + boardConfig` 的 **SHA-256 摘要**。所有写命令携带 `expectedRevision`，冲突返回 `CONFLICT` 不写入。

### 4.3 关键常量

| 常量 | 值 | 说明 |
|------|------|------|
| `DEFAULT_GROUP_ID` | `g_all` | 默认分组 ID |
| `MAX_GROUPS` | `20` | 分组上限（1 默认 + 19 自定义） |
| `DEFAULT_FRESHNESS_MS` | `30_000` | fresh 窗口 |
| `CACHE_MAX_AGE_MS` | `604_800_000` | 缓存最大存活（7 天） |

---

## 5. API 集成指南

> 字段映射的完整细节与陷阱（f13 缺失、fltt=2、f51/f52 非涨跌停）见 [module-quotes.md](module-quotes.md)。

### 5.1 东方财富行情 API（主源）

**端点**：`GET https://push2.eastmoney.com/api/qt/ulist.np/get`

- 参数：`fltt=2&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23&secids=1.600519,0.000001`
- secids：`sh → 1.`、`bj/sz → 0.`
- **`fltt=2` 返回浮点值（元/百分比），无需缩放**
- 响应：`json.data.diff[]`

**字段映射**：f2=现价 f3=涨跌幅 f4=涨跌额 f5=成交量 f6=成交额 f7=振幅 f8=换手率 f9=市盈率 f10=量比 f12=代码 f13=市场 f14=名称 f15=最高 f16=最低 f17=今开 f18=昨收 f20=总市值 f21=流通市值 f23=市净率

> 涨停/跌停价**缺席**（该 endpoint 不提供，改用逐只接口会让 500 只变 500 次请求）。

### 5.2 东方财富搜索 API

**端点**：`GET https://searchapi.eastmoney.com/api/suggest/get`

- 参数：`input={关键词}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=15`
- SecurityType 白名单：`{1,2,25,27}`（沪A/深A/科创板/北交所）

### 5.3 腾讯行情 API（备源，v2.0.1 起）

**端点**：`GET https://qt.gtimg.cn/q=sh600519,sz000001`

- URL 直接拼接带前缀的代码，无需 secids 转换
- 响应：GBK 文本，逐行 `v_<code>="..."`，字段以 `~` 分隔（88 槽位）
- **涨跌停价仅腾讯源提供**：[1]=名称 [3]=现价 [4]=昨收 [5]=今开 [31]=涨跌额 [32]=涨跌幅 [33]=最高 [34]=最低 [36]=成交量 [38]=换手率 [39]=市盈率 [43]=振幅 [44]=流通市值 [45]=总市值 [46]=市净率 [47]=涨停价 [48]=跌停价 [49]=量比

**备源选型理由**：原新浪 `hq.sinajs.cn` 自 2022 起强制 Referer 校验，MV3 SW 无法设置（forbidden header），实测固定 403。腾讯无此限制。

### 5.4 行情缓存与降级

插件**不生成任何模拟行情**。降级链：

1. 东方财富主源（4s 超时 / 50 只批 / 最多 2 批并发）
2. 腾讯备源（仅查主源缺失的 code）
3. 本地缓存兜底（7 天内，30s 内为 fresh）
4. 缺失 → `--`

失败退避：`30s → 2m → 5m`，持久化到 `chrome.storage.session`，SW 重建后恢复。

---

## 6. 安全与权限

### 6.1 权限最小化

- `storage`：本地数据存储
- `alarms`：后台定时刷新

### 6.2 主机权限

仅三个数据源域名：`push2.eastmoney.com` / `searchapi.eastmoney.com` / `qt.gtimg.cn`

### 6.3 CSP 与代码安全

- CSP：`script-src 'self'; object-src 'self'`
- 无远程代码，无内联事件处理器，零运行时第三方依赖

### 6.4 数据隐私

- 所有自选股数据存储在本地，不上传服务器
- 行情请求仅发送股票代码，不含用户身份信息
- 无分析追踪、无遥测数据收集

---

## 7. 版本历史

完整变更流水见根目录 [CHANGELOG.md](../CHANGELOG.md)。

| 版本 | 要点 |
|------|------|
| **v2.0.1** | 列设置修复、详情面板（5→16 项）、「管理持仓」改名、成交额以亿为主、行情字段扩展、备源改腾讯、f51/f52 修正 |
| **v2.0.0** | TypeScript 分层架构重建、单一 StorageCoordinator、RPC v2、不可变 Store + Reducer、架构边界门禁 |
| v1.2.1 | 「全部」计算视图、schema v2 迁移、行情三态、串行写入、E2E + CI |
| v1.1.0 | 科创板 / 北交所、搜索 API 联想补全 |
| v1.0.0 | 首个正式版：分组看板、双视图、拖拽排序、列配置、智能搜索 |
