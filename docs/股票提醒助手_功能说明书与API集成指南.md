# 股票提醒助手 — 功能说明书与 API 集成指南

> 版本：v1.0.0（首个正式版）｜ 平台：Chrome 浏览器扩展（Manifest V3） ｜ 文档更新日期：2026-07-10

---

## 1. 文档概述

本文档为「股票提醒助手」浏览器扩展的功能说明书与 API 集成指南，面向开发者和维护人员。文档涵盖插件的完整功能规格、数据模型、存储结构、三个外部 API 的集成细节（东方财富搜索 API、东方财富行情 API、新浪财经行情 API）、演示数据兜底机制、安全与权限设计，以及文件结构说明。

本文档内容均基于插件源码（`popup.js`、`quotes.js`、`storage.js`、`background.js`、`manifest.json`、`popup.html`、`popup.css`）编写，所有代码引用均可追溯至对应文件。

---

## 2. 插件概述

### 2.1 基本信息

「股票提醒助手」是一款基于 Chrome Manifest V3 的浏览器扩展，为用户提供自选股分组管理、实时行情看板、智能搜索补全和后台 Badge/Tooltip 提醒功能。插件不使用任何远程代码，所有逻辑均在本地执行。

- **版本**：1.0.0（首个正式版）
- **Manifest 版本**：V3
- **权限**：`storage`、`alarms`
- **主机权限**：`https://hq.sinajs.cn/*`、`https://push2.eastmoney.com/*`、`https://searchapi.eastmoney.com/*`
- **CSP 策略**：`script-src 'self'; object-src 'self'`
- **主色调**：`#3A6EA5`（蓝色）
- **涨跌色惯例**：红色 = 涨（`#E74C3C`），绿色 = 跌（`#27AE60`），灰色 = 平（`#95A5A6`）

### 2.2 架构设计

插件采用分层架构，各职责清晰分离：

- **UI 层**（`popup.html` / `popup.css`）：弹窗界面结构与样式
- **逻辑层**（`popup.js`）：主交互逻辑，包含状态管理、看板渲染、事件绑定、搜索补全
- **数据层**（`storage.js`）：基于 `chrome.storage.local` 的本地存储读写与数据迁移
- **行情层**（`quotes.js`）：行情数据获取与搜索，含三级降级策略
- **后台层**（`background.js`）：Service Worker，负责 Badge 和 Tooltip 的定时更新

数据流向为：用户操作 → `popup.js` 调用 `storage.js` 持久化 → `popup.js` 调用 `quotes.js` 获取行情 → 渲染看板。后台 `background.js` 独立运行，通过 `chrome.alarms` 定时刷新，通过 `chrome.storage.onChanged` 监听数据变化即时更新 Badge。

### 2.3 文件结构

```text
stock-alert-extension/
├── manifest.json       # 扩展清单（Manifest V3）
├── popup.html          # 弹窗 HTML 结构
├── popup.css           # 弹窗样式
├── popup.js            # 主逻辑（~990 行）
├── storage.js          # 本地存储层（216 行）
├── quotes.js           # 行情数据层（236 行）
├── background.js       # Service Worker（110 行）
└── icons/              # 图标资源（16/32/48/128px）
```

---

## 3. 功能说明书

### 3.1 自选股分组管理

插件支持多分组管理自选股，默认提供「全部」分组（`g_all`），用户可创建最多 20 个自定义分组。

**分组操作：**

- **创建分组**：调用 `Storage.createGroup(name)`，校验分组名唯一性和数量上限（`MAX_GROUPS = 20`）。分组 ID 格式为 `g_` + 时间戳。
- **重命名分组**：调用 `Storage.renameGroup(groupId, name)`，校验名称不与其他分组冲突。
- **删除分组**：调用 `Storage.deleteGroup(groupId)`，默认分组不可删除。删除时组内股票移回「全部」（若同时属于其他分组则保留），同时清理该分组的 `manualOrder`、`pinned` 和 `boardConfig`。整个操作在一次 `chrome.storage.local.set` 中原子完成，避免多次独立写入。
- **重排序分组**：调用 `Storage.reorderGroups(newOrderIds)`，「全部」分组始终固定首位，其余按用户拖拽顺序排列。

**自选股操作：**

- **添加股票**：`Storage.addStock(code, name, groupIds)` — 若股票已存在则合并 `groupIds`，否则创建新记录。新记录包含 `code`、`name`、`groupIds`、`manualOrder`（空对象）、`pinned`（空对象）、`addedAt`（时间戳）。
- **移除股票**：从非默认分组移除仅解除该分组关联；从「全部」移除则彻底删除。支持单只移除（`removeStock`）和批量移除（`removeStocksBatch`）。
- **移动股票**：`Storage.moveStocksToGroups(codes, fromGroupId, targetGroupIds)` — 从源分组移除并添加到目标分组，确保至少保留在「全部」中。
- **手动排序**：`Storage.setManualOrder(groupId, orderedCodes)` — 按拖拽顺序写入 `manualOrder[groupId]`。
- **置顶**：`Storage.togglePin(groupId, code)` — 切换 `pinned[groupId]` 布尔值。

### 3.2 实时行情看板

看板支持两种视图模式，每分组独立保存配置：

**网格视图（Grid）：**

- 卡片式布局，每张卡片显示名称、现价、涨跌额和涨跌幅
- 涨跌颜色：红色背景表示上涨，绿色表示下跌，灰色表示平盘
- 置顶股票显示 📌 图标
- 非批量模式下，右上角「⋯」按钮用于单只移除
- 批量模式下，右上角显示选择框（☑/☐），点击卡片切换选中状态
- 鼠标悬浮显示行情详情 Tooltip
- 支持拖拽排序（非批量模式）

**列表视图（List）：**

- 表格式布局，列可自定义
- 表头点击切换排序字段和方向（升序 ↑ / 降序 ↓）
- 左侧拖拽手柄（⋮⋮）用于拖拽排序
- 右侧操作列提供单只移除按钮（✕）
- 批量模式下点击行切换选中，选中行高亮背景

**自动刷新：**

- 弹窗打开时立即刷新一次行情
- 之后每 10 秒自动刷新（`setInterval`）
- 后台 Service Worker 每 30 秒刷新一次（`chrome.alarms`，`REFRESH_MINUTES = 0.5`）

### 3.3 搜索与添加股票

搜索功能包含两个层面：看板内筛选和添加股票时的搜索补全。

**看板内筛选：**

在搜索框输入关键词后，`getGroupStocks()` 对当前分组内的股票执行 4 种匹配方式：

1. **代码匹配**（前缀/包含）：去除 `sh`/`sz` 前缀后的纯数字代码包含关键词，或完整代码包含关键词
2. **中文名称包含**：股票名称包含关键词
3. **拼音首字母匹配**：从 `HOT_STOCKS` 查找元数据，拼音首字母包含关键词
4. **行业标签匹配**：从 `HOT_STOCKS` 查找元数据，行业标签包含关键词

**添加股票搜索补全：**

`renderCodeSuggest(keyword)` 实现异步搜索补全：

- 输入后立即显示「搜索中…」
- 300ms 防抖后调用 `Quotes.searchStocks(kw)` 请求东方财富搜索 API
- 使用 `_searchSeq` 序列号防止竞态条件：仅渲染最新请求的结果
- API 返回结果时渲染最多 10 条建议项，标签为「A股」
- API 失败或返回空时，降级到本地 `HOT_STOCKS` 4 种匹配（前缀 → 代码包含 → 拼音前缀 → 拼音包含 → 名称包含 → 行业包含，优先级 1-6）
- 每条建议项显示匹配类型徽章（前缀/代码/拼音/名称/行业）

**添加股票验证：**

`submitAddStock()` 自动补全 `sh`/`sz` 前缀，校验格式 `/^s[hz]\d{6}$/`，重复添加时根据是否在当前分组显示不同的 Toast 提示。

### 3.4 排序与列配置

**排序：**

- 排序字段：`manual`（手动）、`addedAt`（自选时间）、`name`（名称）、以及所有行情字段（`price`、`change`、`changePercent`、`open`、`prevClose`、`high`、`low`、`volume`、`amount`）
- 排序方向：升序（`asc`）/ 降序（`desc`）
- 置顶股票始终排在最前，不受排序字段影响
- 排序时预计算 `enrich` 后的行情数据到 `Map`，避免排序比较中重复调用

**列配置（列表视图）：**

- 可选字段共 12 个：`name`（名称）、`code`（代码）、`price`（现价）、`change`（涨跌额）、`changePercent`（涨跌幅）、`open`（今开）、`prevClose`（昨收）、`high`（最高）、`low`（最低）、`volume`（成交量）、`amount`（成交额）、`addedAt`（自选时间）
- 默认列：`name`、`price`、`change`、`changePercent`
- 支持列的显示/隐藏切换和顺序调整
- 配置按分组独立保存

### 3.5 拖拽排序

- 网格视图和列表视图均支持拖拽排序（非批量模式）
- 拖拽时添加 `drag-over` CSS 类高亮目标
- 拖拽完成后调用 `manualReorder(srcCode, targetCode)` 更新 `manualOrder`
- 分组标签也支持拖拽重排序

### 3.6 置顶功能

- 点击卡片/行切换置顶状态（`togglePin`）
- 右键点击同样切换置顶（`oncontextmenu`）
- 置顶状态按分组独立保存（`pinned[groupId]`）
- 置顶股票在排序时始终排在最前
- 网格视图中置顶股票显示 📌 图标
- 后台 Tooltip 优先显示「全部」分组中置顶的股票

### 3.7 批量操作

- 点击「批量管理」按钮进入批量模式
- 批量模式下点击卡片/行切换选中状态，选中项高亮
- 支持批量移除（`removeStocksBatch`）和批量移动到其他分组（`moveStocksToGroups`）
- 批量操作完成后自动退出批量模式并清空选中集合

### 3.8 价格隐藏

- 点击「隐藏价格」按钮切换 `priceHidden` 状态
- 开启后，现价、涨跌额、涨跌幅、今开、昨收、最高、最低均显示为 `****`
- 网格视图和列表视图均生效

### 3.9 Badge 与 Tooltip

后台 Service Worker（`background.js`）负责更新扩展图标的 Badge 和 Tooltip：

**Badge：**

- 显示置顶股票的涨跌幅（优先「全部」分组中置顶的股票，无置顶则取第一个自选股）
- 格式化规则（Chrome Badge 最多 4 字符，不带正负号，通过红绿背景判断涨跌）：
  - `|涨跌幅| ≥ 1000`：显示 `999`（上限）
  - `|涨跌幅| ≥ 100`：整数（如 `105`）
  - `|涨跌幅| ≥ 10`：整数（如 `12`）
  - 其他：一位小数（如 `2.5`）
- 颜色：涨 = 红色（`#E74C3C`），跌 = 绿色（`#27AE60`），平 = 灰色（`#95A5A6`）
- 无行情数据时显示 `--`

**Tooltip：**

- 优先显示「全部」分组中置顶的股票排前面，然后按 watchlist 顺序，最多显示 5 只
- 多行格式：`名称 ▲/▼ 涨跌幅%`（每行一只股票）
- 单只无行情数据时显示「暂无数据」

**更新时机：**

- `chrome.runtime.onInstalled` — 安装时
- `chrome.runtime.onStartup` — 浏览器启动时
- `chrome.alarms.onAlarm` — 每 30 秒定时刷新
- `chrome.storage.onChanged` — 自选股或分组变化时立即更新

### 3.10 数据源标签

看板底部显示当前行情数据来源：

- 实时数据：`行情数据：实时 · 东方财富` 或 `行情数据：实时 · 新浪财经`
- 演示数据：`行情数据：演示数据（Demo）`（橙色样式 `data-source demo`）

---

## 4. 数据模型与存储

### 4.1 存储结构

所有数据存储在 `chrome.storage.local` 中，包含以下键：

**`groups`（分组数组）：**

```json
{
  "groupId": "g_all",
  "name": "全部",
  "order": 0,
  "isDefault": true,
  "createdAt": 1689000000000,
  "updatedAt": 1689000000000
}
```

- `groupId`：分组唯一标识，默认分组为 `g_all`，自定义分组为 `g_` + 时间戳
- `order`：排序序号，「全部」始终为 0
- `isDefault`：是否为默认分组（不可删除）

**`watchlist`（自选股数组）：**

```json
{
  "code": "sh600519",
  "name": "贵州茅台",
  "groupIds": ["g_all", "g_1689000000000"],
  "manualOrder": { "g_all": 0, "g_1689000000000": 2 },
  "pinned": { "g_all": true },
  "addedAt": 1689000000000
}
```

- `code`：股票代码，格式为 `sh`/`sz` + 6 位数字
- `groupIds`：所属分组 ID 列表（一只股票可属于多个分组）
- `manualOrder`：各分组内的手动排序序号
- `pinned`：各分组内的置顶状态
- `addedAt`：添加时间戳

**`boardConfig`（看板配置对象）：**

以 `groupId` 为键，每个分组独立保存：

```json
{
  "g_all": {
    "viewMode": "grid",
    "sortField": "manual",
    "sortDirection": "desc",
    "columns": ["name", "price", "change", "changePercent"],
    "columnOrder": ["name", "price", "change", "changePercent"]
  }
}
```

- `viewMode`：视图模式（`grid` / `list`）
- `sortField`：排序字段
- `sortDirection`：排序方向（`asc` / `desc`）
- `columns`：显示的列
- `columnOrder`：列的顺序

**`watchlist_legacy`（旧版数据，用于迁移）：**

旧版扁平列表格式，迁移完成后保留作为备份。

### 4.2 数据迁移

`Storage._migrate(legacyList)` 将旧版扁平 watchlist 迁移到分组结构：

- 创建默认「全部」分组
- 每只股票分配到「全部」分组，初始化空的 `manualOrder` 和 `pinned`
- `addedAt` 按原顺序递减（`now - i * 1000`），保持原有排序
- 迁移结果一次性写入 `chrome.storage.local`

迁移触发条件：`loadAll()` 检测到 `groups` 或 `watchlist` 不存在，但 `watchlist_legacy` 存在。

### 4.3 常量定义

| 常量 | 值 | 说明 |
|---|---|---|
| `DEFAULT_GROUP_ID` | `g_all` | 默认分组 ID |
| `DEFAULT_GROUP_NAME` | `全部` | 默认分组名称 |
| `MAX_GROUPS` | `20` | 最大分组数 |
| `ALARM_NAME` | `quote-refresh` | 定时器名称 |
| `REFRESH_MINUTES` | `0.5` | 后台刷新间隔（30 秒） |

---

## 5. API 集成指南

### 5.1 东方财富搜索 API

用于添加股票时的实时搜索补全，替代本地硬编码的热门股票库。

**端点：**

```
GET https://searchapi.eastmoney.com/api/suggest/get
```

**请求参数：**

| 参数 | 值 | 说明 |
|---|---|---|
| `input` | 用户输入关键词 | 代码前缀、拼音、中文名称 |
| `type` | `14` | 14 = A 股 |
| `token` | `D43BF722C8E33BDC906FB84D85E326E8` | 东方财富公开 token |
| `count` | `15` | 返回条数上限 |

**请求示例：**

```
https://searchapi.eastmoney.com/api/suggest/get?input=6001&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=15
```

**响应格式：**

API 返回 JSON，存在两种格式（需兼容处理）：

- 格式一：`QuotationCodeTable` 直接在根级
- 格式二：`QuotationCodeTable` 包裹在 `_oma_data` 内

代码中通过以下方式兼容：

```javascript
const table = json.QuotationCodeTable || (json._oma_data && json._oma_data.QuotationCodeTable);
const data = table && table.Data;
```

**响应数据项字段：**

| 字段 | 说明 | 示例 |
|---|---|---|
| `Code` | 6 位股票代码 | `600519` |
| `Name` | 股票名称 | `贵州茅台` |
| `PinYin` | 拼音首字母 | `GZMT` |
| `Classify` | 证券分类 | `AStock` |
| `MktNum` | 市场编号 | `1`=沪市, `2`=深市 |

**过滤规则：**

API 会返回混合类型（A股、板块 BK、基金 Fund、指数 Index 等），必须过滤：

- `Classify === 'AStock'` — 仅保留 A 股
- `/^\d{6}$/.test(rawCode)` — 代码必须为 6 位纯数字

**市场前缀映射：**

- `MktNum === '1'` → `sh`（沪市）
- `MktNum === '2'` → `sz`（深市）

**返回值：**

```javascript
[{ code: 'sh600519', name: '贵州茅台', pinyin: 'GZMT' }, ...]
```

**错误处理：**

- HTTP 非 200：抛出错误，被 `catch` 捕获
- 响应解析失败：返回空数组 `[]`
- 网络异常：返回空数组 `[]`
- 调用方（`popup.js`）在收到空数组时降级到本地 `HOT_STOCKS` 匹配

### 5.2 东方财富行情 API（主源）

用于获取自选股的实时行情数据，作为主数据源。

**端点：**

```
GET https://push2.eastmoney.com/api/qt/ulist.np/get
```

**请求参数：**

| 参数 | 值 | 说明 |
|---|---|---|
| `fltt` | `2` | 精度格式 |
| `fields` | `f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18` | 请求字段列表 |
| `secids` | `1.600519,0.300418` | 证券 ID 列表（逗号分隔） |

**secid 格式：**

- 沪市：`1.` + 6 位代码（如 `1.600519`）
- 深市：`0.` + 6 位代码（如 `0.300418`）

`_toSecids(codes)` 转换规则：代码以 `sh`、`1` 或 `5` 开头 → 前缀 `1.`，否则前缀 `0.`。

**字段映射：**

| API 字段 | 含义 | 映射到 |
|---|---|---|
| `f2` | 现价 | `price` |
| `f3` | 涨跌幅 | `changePercent` |
| `f4` | 涨跌额 | `change` |
| `f5` | 成交量 | `volume` |
| `f6` | 成交额 | `amount` |
| `f12` | 股票代码 | 用于匹配 |
| `f13` | 市场编号 | `1`=沪市, `0`=深市 |
| `f14` | 股票名称 | `name` |
| `f15` | 最高价 | `high` |
| `f16` | 最低价 | `low` |
| `f17` | 今开 | `open` |
| `f18` | 昨收 | `prevClose` |

**响应结构：**

```json
{
  "data": {
    "diff": [
      {
        "f2": 1689.00, "f3": 0.81, "f4": 13.50,
        "f5": 12345678, "f6": 9876543210,
        "f12": "600519", "f13": 1, "f14": "贵州茅台",
        "f15": 1695.00, "f16": 1680.00, "f17": 1685.00, "f18": 1675.50
      }
    ]
  }
}
```

**空值安全处理：**

- `if (!item || item.f12 == null) return;` — 跳过 null/无效项
- 停牌股票部分字段返回 `"-"` 字符串，`enrich()` 中的 `_num()` 将其转为 `null`

**代码匹配：**

API 返回的 `f12` 是纯数字代码，需匹配用户原始代码格式（可能带 `sh`/`sz` 前缀）：

```javascript
const matched = codes.find(c => c.toLowerCase().endsWith(rawCode)) || code;
```

### 5.3 新浪财经行情 API（备源）

当东方财富 API 失败时，降级到新浪财经作为备用数据源。

**端点：**

```
GET https://hq.sinajs.cn/list=sh600519,sz300418
```

**请求参数：**

- `list`：股票代码列表，逗号分隔，代码需带 `sh`/`sz` 前缀

**响应格式：**

响应为 GBK 编码的文本，每行一只股票：

```text
var hq_str_sh600519="贵州茅台,1685.00,1675.50,1689.00,1695.00,1680.00,1685.00,1689.00,12345678,9876543210,...";
```

**GBK 解码：**

浏览器扩展中 `fetch` 无法设置 `Referer` 头，部分情况新浪会返回空。响应为 GBK 编码，必须用 `TextDecoder('gbk')` 解码：

```javascript
const buffer = await resp.arrayBuffer();
const text = new TextDecoder('gbk').decode(buffer);
```

**字段解析（以逗号分隔）：**

| 索引 | 含义 | 映射到 |
|---|---|---|
| 0 | 股票名称 | `name` |
| 1 | 今开 | `open` |
| 2 | 昨收 | `prevClose` |
| 3 | 现价 | `price` |
| 4 | 最高价 | `high` |
| 5 | 最低价 | `low` |
| 8 | 成交量 | `volume` |
| 9 | 成交额 | `amount` |

**注意：** 新浪 API 不直接返回涨跌额和涨跌幅，`enrich()` 会根据 `price` 和 `prevClose` 自动计算。

### 5.4 演示数据兜底

当东方财富和新浪均失败时，使用本地演示数据确保功能可用。

**演示数据基础库（`_demoBase`）：**

包含 8 只股票的基准价格和昨收：

| 代码 | 名称 | 基准价 | 昨收 |
|---|---|---|---|
| `sz300418` | 昆仑万维 | 50.65 | 47.96 |
| `sh600519` | 贵州茅台 | 1689.00 | 1675.50 |
| `sz000858` | 五粮液 | 156.20 | 158.40 |
| `sh601318` | 中国平安 | 48.30 | 47.80 |
| `sz300750` | 宁德时代 | 210.50 | 205.00 |
| `sh600036` | 招商银行 | 35.80 | 36.10 |
| `sz002475` | 立讯精密 | 38.90 | 37.50 |
| `sh601899` | 紫金矿业 | 14.20 | 13.85 |

**数据生成逻辑：**

- 基础库中的股票：在基准价上添加 ±0.5% 随机抖动，计算涨跌额和涨跌幅
- 基础库外的股票：生成 10-50 之间的随机价格，计算相关字段
- 所有字段（`open`、`high`、`low`、`volume`、`amount`）均随机生成

**标识：**

- `Quotes.isDemo = true`
- `Quotes._sourceName = '演示数据'`
- 看板底部显示橙色标签：`行情数据：演示数据（Demo）`

### 5.5 数据流转与降级策略

`Quotes.fetch(codes)` 是行情数据的主入口，按以下顺序依次尝试：

1. **东方财富（主源）**：调用 `_fetchEastmoney(codes)`，成功且返回非空 → 设置 `isDemo=false`、`_sourceName='东方财富'`，返回结果
2. **新浪财经（备源）**：东方财富失败或返回空 → 调用 `_fetchSina(codes)`，成功且返回非空 → 设置 `isDemo=false`、`_sourceName='新浪财经'`，返回结果
3. **演示数据（兜底）**：两者均失败 → 设置 `isDemo=true`、`_sourceName='演示数据'`，返回 `_demo(codes)`

每一级失败均通过 `try/catch` 捕获并 `console.warn` 记录，不会中断流程。

### 5.6 enrich() 数据加工

`Quotes.enrich(q)` 对原始行情数据进行安全处理和计算：

- **数值安全**：`_num(v)` 将 `"-"`、`""`、`null`、`undefined` 转为 `null`，避免 `.toFixed()` 崩溃
- **涨跌额计算**：若 `change` 为 `null` 且 `price` 和 `prevClose` 均有效，则 `change = price - prevClose`
- **涨跌幅计算**：若 `changePercent` 为 `null` 且 `change` 和 `prevClose` 均有效，则 `changePercent = (change / prevClose) * 100`

东方财富 API 直接返回 `change` 和 `changePercent`，新浪和演示数据需要 `enrich()` 计算。

---

## 6. 安全与权限

### 6.1 权限最小化

插件仅请求两个必要权限：

- `storage`：用于 `chrome.storage.local` 存储自选股数据
- `alarms`：用于后台定时刷新 Badge

### 6.2 主机权限

仅请求三个数据源域名：

- `https://push2.eastmoney.com/*` — 东方财富行情 API
- `https://searchapi.eastmoney.com/*` — 东方财富搜索 API
- `https://hq.sinajs.cn/*` — 新浪财经行情 API

### 6.3 CSP 与代码安全

- **CSP 策略**：`script-src 'self'; object-src 'self'` — 仅允许加载扩展自身资源
- **无远程代码**：插件不使用任何远程 JavaScript，所有逻辑均在扩展包内
- **无内联事件处理器**：Manifest V3 的 CSP 阻止所有内联事件处理器（如 `onclick="..."`），所有事件均通过 `addEventListener` 或 `.onclick =` 在 JavaScript 中绑定
- **XSS 防护**：所有用户可见的文本均通过 `esc()` 函数进行 HTML 转义（`&`、`<`、`>`、`"`、`'`）

### 6.4 数据隐私

- 所有自选股数据存储在本地 `chrome.storage.local`，不上传到任何服务器
- 行情请求仅发送股票代码，不包含任何用户身份信息
- 无分析追踪、无遥测数据收集

---

## 7. 版本历史

| 版本 | 主要变更 |
|---|---|
| 1.0.0 | 首个正式版本：自选股分组管理、实时行情看板、网格/列表双视图、排序/拖拽/置顶、批量操作、列配置、价格隐藏、悬浮行情 Tooltip、Badge 提醒、东方财富搜索 API 补全、三级行情降级策略、虚拟滚动（>50只）、配置写入防抖 200ms |
| 0.1.0 | 初始开发版本：自选股分组管理、实时行情看板、网格/列表双视图、排序/拖拽/置顶、批量操作、列配置、价格隐藏、悬浮行情 Tooltip、Badge 提醒、东方财富搜索 API 补全、三级行情降级策略 |

---

## 附录 A：字段标签对照表

| 字段 key | 中文标签 | 说明 |
|---|---|---|
| `name` | 名称 | 股票名称 |
| `code` | 代码 | 股票代码（sh/sz + 6位数字） |
| `price` | 现价 | 当前价格 |
| `change` | 涨跌额 | 现价 - 昨收 |
| `changePercent` | 涨跌幅 | 涨跌额 / 昨收 × 100% |
| `open` | 今开 | 今日开盘价 |
| `prevClose` | 昨收 | 昨日收盘价 |
| `high` | 最高 | 今日最高价 |
| `low` | 最低 | 今日最低价 |
| `volume` | 成交量 | 今日成交量 |
| `amount` | 成交额 | 今日成交额 |
| `addedAt` | 自选时间 | 添加到自选的时间 |

## 附录 B：HOT_STOCKS 热门股票库

本地热门股票库共 32 只，覆盖常见代码前缀，用于 API 搜索失败时的降级匹配和看板内拼音/行业筛选：

- **6000xx**（8 只）：浦发银行、上海机场、民生银行、中国石化、南方航空、中信证券、招商银行、中国联通
- **6001xx**（2 只）：上汽集团、复星医药
- **6013xx**（2 只）：中国平安、工商银行
- **6016xx**（1 只）：华泰证券
- **6019xx**（2 只）：中国银行、中国石油
- **0000xx**（2 只）：平安银行、万科A
- **0024xx**（2 只）：海康威视、立讯精密
- **3007xx**（2 只）：宁德时代、迈瑞医疗
- 其他：恒瑞医药、万华化学、贵州茅台、伊利股份、中国石油、美的集团、云南白药、格力电器、京东方A、五粮液、比亚迪、东方财富等

每只股票包含 `code`（代码）、`name`（名称）、`tag`（行业标签）、`pinyin`（拼音首字母）四个字段。
