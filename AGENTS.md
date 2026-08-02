# AGENTS.md — 股票提醒助手（Chrome 扩展，Manifest V3）

新会话从本文件起步；权威架构说明见 [docs/项目架构.md](docs/项目架构.md)。

## 入口文件

| 文件 | 角色 |
|------|------|
| `manifest.json` | 扩展清单（MV3）：`action.default_popup` = popup.html，`background.service_worker` = background.js；权限仅 `storage` + `alarms`；host_permissions 覆盖三个数据源域名（hq.sinajs.cn / push2.eastmoney.com / searchapi.eastmoney.com） |
| `background.js` | Service Worker：badge/tooltip 渲染、`chrome.alarms` 行情调度、`Router.init` 注入行情服务；加载顺序 `stock-utils.js → storage.js → quotes.js → quote-service.js → quote-format.js → router.js` |
| `router.js` | RPC 消息总线（`chrome.runtime.onMessage`），14 个 action 分发到 QuoteService/Storage；未知 action 返回 `UNKNOWN_ACTION` |
| `popup.html` | 弹窗 UI 入口，脚本加载顺序：`stock-utils.js → quote-format.js → quotes.js（仅 searchStocks）→ popup-bridge.js → popup-state.js → popup-render.js → popup-actions.js → popup.js` |

popup 与 Service Worker 通过 `popup-bridge.js`（RPC 客户端，10s 超时）→ `chrome.runtime.sendMessage` 通信；行情编排只发生在 SW，popup 内 `quotes.js` 仅用于搜索联想。

## 命令面（package.json scripts）

- `npm run check`：check:syntax（node --check 全部 JS）+ check:types（tsc）+ lint（eslint）+ validate:manifest
- `npm run test:unit`：node:test 跑 `tests/unit/*.test.mjs`，c8 覆盖率门槛 lines 90 / branches 85 / functions 90 / statements 90
- `npm run test:e2e`：Playwright（`tests/e2e/`，经 chrome-mock 加载扩展）
- `npm run ci`：check + test:unit + test:e2e（合并验证入口）
- `npm run release:verify`：ci + capture:store + package:extension
- 单测依赖 chrome mock（`tests/helpers/chrome-mock.mjs`），各模块通过注入依赖测试

## 核心边界（不变量）

- **存储**：`storage.js` 只写 `chrome.storage.local`；schema v2 由 `groups` / `watchlist` / `boardConfig` / `quoteCache:<code>` 组成；`g_all`（「全部」）是计算视图，不存储成员标记；所有用户数据修改必须经串行写入队列 `mutateUserData`（防并发 lost-update）；schema 迁移走 `migrateToV2` 并备份到 `migrationBackup:v1.2.1`
- **行情**：`quotes.js` 是纯传输层（东财主源 + 新浪备源 + 搜索），只返回真实远端数据；`quote-service.js` 负责编排（4s 超时、50 只/批、缓存 30s 内 fresh / 30s~7 天 cached / 超期删除、失败退避 30s→2m→5m）；`price > 0` 才视为可用行情（停牌/盘前 0.00 按缺失处理）；缺失时保留未过期缓存，**绝不生成模拟价格**
- **代码规范**：股票代码带市场前缀 `sh` / `sz` / `bj`（沪深主板、科创板 sh，深市/创业板 sz，北交所 bj），统一经 `stock-utils.js` 的 `normalizeStockCode` 规范化
- **调度**：刷新间隔由 `quote-format.js` 计算——盘中 popup 10s / 后台 alarm 30s，盘外 5 分钟

## 风险路由（改哪里、注意什么）

- 改行情逻辑 → `quotes.js`（传输/解析）或 `quote-service.js`（编排）；退避期内近期缓存不得再以 fresh 呈现；QuoteService 常驻 SW，退避状态跨 popup 重载存活，勿引入空自选股刷新累积失败计数
- 改存储 schema/字段 → `storage.js`：必须同时更新 `sanitizeV2`、迁移路径与备份键，保持 v1.2.1→v2 兼容；所有写操作走串行队列
- 新增/修改 RPC action → `router.js` 的 `createHandlers` + `popup-bridge.js` 两端同步；payload 用 `assert*` 校验
- 改权限/入口/域名 → `manifest.json`；host_permissions 只允许上述三个数据源域名
- 改动后验证 → `npm run ci`（单测含覆盖率门槛，e2e 覆盖完整用户流）；纯传输/编排改动优先跑 `tests/unit/quote-service.test.mjs`、`tests/unit/quotes.test.mjs`、`tests/unit/storage-mutations.test.mjs`
