# AGENTS.md — 股票提醒助手（Chrome 扩展，Manifest V3，v2.0.0 TypeScript/ESM）

新会话从本文件起步；权威架构说明见 [docs/项目架构.md](docs/项目架构.md)。

## 入口文件

| 文件 | 角色 |
|------|------|
| `extension/manifest.json` | 扩展清单（MV3）：`action.default_popup` = popup.html，`background.service_worker` = `runtime/background/main.js`（`type: "module"`）；权限仅 `storage` + `alarms`；host_permissions 覆盖三个数据源域名（push2.eastmoney.com / searchapi.eastmoney.com / qt.gtimg.cn） |
| `extension/popup.html` | 弹窗 UI 入口：`<stock-app hidden>` + `#fatal-fallback` + `<script type="module" src="runtime/popup/main.js">`；链式加载 `tokens.css → layout.css → components.css` |
| `src/background/main.ts` | Service Worker 组合根：同步注册所有 Chrome listener（onMessage/onAlarm/onInstalled/onStartup/onChanged），创建 `StorageCoordinator` + Application Services + Router + Scheduler，通过可重试初始化屏障 `idle/running/ready` 处理事件 |
| `src/popup/main.ts` | Popup 组合根：定义 Web Components、创建 RpcClient/Store/CommandController/AppShell，调用 `app:bootstrap`，调度行情刷新 |

`build/extension/` 是 `tsc` 输出 + 静态资源复制的可加载扩展；开发者模式和 Playwright 均加载它，不直接加载源码根。Popup 与 Service Worker 通过 RPC v2（`chrome.runtime.sendMessage`，10s 超时）通信；行情编排和搜索只发生在 SW。

## 架构分层

```text
Presentation (Popup Components)  →  Application (Commands / Services / Ports)  →  Domain (Models / Rules / Errors)
Infrastructure (Chrome / Storage / HTTP)  →  implements  →  Application Ports
```

- `src/domain/` — 值对象、实体、纯规则、格式化（纯 ES2022，无 DOM/Chrome 依赖）
- `src/protocol/` — RPC v2 单一注册表（方法 / payload / result / 运行时校验 / 错误码）
- `src/application/` — 用例（Bootstrap / PortfolioCommands / QuoteService / SearchService）+ Ports
- `src/infrastructure/` — Chrome Storage 适配器 + `StorageCoordinator` + Quote/Search Providers
- `src/background/` — SW listener 注册 + 初始化屏障 + Router + Scheduler + BadgePresenter
- `src/popup/` — 不可变 Store（reducer/selectors）+ Commands + Light DOM Web Components

依赖只能由外向内；`scripts/check-architecture.mjs` 用 TypeScript Compiler API 解析 import graph，拒绝反向 import 和循环依赖。

## 命令面（package.json scripts）

- `npm run build`：`tsc --build` 编译 `src/` → `build/extension/runtime/`，复制 `extension/` 静态资源
- `npm run check`：check:types（tsc）+ lint（eslint）+ check:architecture + build + check:runtime-imports + validate:manifest
- `npm run test:unit`：`tsx` + node:test 跑 `tests/unit/**/*.test.ts`，c8 覆盖率门槛 lines/statements/functions 90 / branches 85
- `npm run test:critical-coverage`：Domain/Protocol/Storage/Reducer per-file 门槛 95/90/95/95
- `npm run test:component`：`tsx` + happy-dom 跑 `tests/component/**/*.test.ts`
- `npm run test:e2e`：Playwright 加载 `build/extension/` 真实扩展 E2E
- `npm run test:a11y`：axe-core 无障碍扫描
- `npm run ci`：check + test:unit + test:critical-coverage + test:component + test:e2e + test:a11y
- `npm run release:verify`：ci + test:performance + npm audit + verify-deterministic-build + capture:store + package:extension + check:bundle
- `npm run test:live`：实网行情冒烟（**不进 ci**，依赖第三方端点可达性）

## 核心边界（不变量）

- **存储**：`StorageCoordinator`（`src/infrastructure/storage/storage-coordinator.ts`）是 `chrome.storage.local` 的唯一业务调用者和唯一写入队列；所有用户数据/缓存读写进入同一串行临界区。schema v2 由 `groups` / `watchlist` / `boardConfig` / `quoteCache:<code>` 组成；`g_all`（「全部」）是计算视图，不存储成员标记。`userDataRevision` 是规范化 `groups + watchlist + boardConfig` 的 SHA-256 摘要，不作为独立 key 持久化。schema 迁移走 `migrateToV2`（幂等）并备份到 `migrationBackup:v1.2.1`（首次写入不覆盖）
- **行情**：`QuoteProvider`（`src/infrastructure/quote-providers/`）是纯传输层（东财主源 + 腾讯备源），只返回真实远端数据；`QuoteService`（`src/application/quotes/`）负责编排（4s Provider 超时、8s 总 deadline、50 只/批、并发 2、fresh `<30s` / cached `30s~7d` / 超期删除、失败退避 `30s→2m→5m` 持久化到 `chrome.storage.session`）；`price > 0` 才视为可用行情；缺失时保留未过期缓存，**绝不生成模拟价格**；空自选股不请求网络也不改变退避状态
- **代码规范**：股票代码带市场前缀 `sh` / `sz` / `bj`，统一经 `src/domain/stock.ts` 的 `normalizeStockCode` 规范化
- **RPC v2**：`src/protocol/registry.ts` 是唯一的 RPC 方法/payload/result/validator 注册表（13 个方法）；所有写命令是幂等最终态命令并携带 `expectedRevision`；冲突返回 `CONFLICT` 不写入；`requestId` 贯穿全链路
- **Popup Store**：`src/popup/store/reducer.ts` 是 `AppState` 的唯一写入口（纯函数）；`domain.boardConfig` 是持久偏好的唯一真相；超时写入进入 uncertain 状态，经 bootstrap 对账确认后更新——绝不盲目回滚
- **调度**：刷新间隔由市场状态计算——盘中 popup 10s / 后台 alarm 30s，盘外 5 分钟；每次任务先创建安全 Alarm（5 分钟），结束后替换为精确 Alarm；每次 SW 激活执行 `ensureAlarm`

## 风险路由（改哪里、注意什么）

- 改行情逻辑 → `src/infrastructure/quote-providers/`（传输/解析）或 `src/application/quotes/quote-service.ts`（编排）；退避状态持久化到 `chrome.storage.session`，SW 重建后恢复
- 改存储 schema/字段 → `src/infrastructure/storage/sanitize-v2.ts` + `migration-service.ts` + `storage-coordinator.ts`：必须保持 v1.2.1→v2 兼容，所有写操作走 Coordinator 单队列
- 新增/修改 RPC 方法 → `src/protocol/registry.ts`（单一注册表）+ `src/background/rpc-handlers.ts`（exhaustive handler 表）两端同步；payload 用注册表内联 validator 校验
- 改 Popup 状态流 → `src/popup/store/reducer.ts`（唯一写入口）+ `selectors.ts`；组件只接收 ViewModel、发出语义事件，不访问 Store/RPC/Repository
- 改权限/入口/域名 → `extension/manifest.json`；host_permissions 只允许上述三个数据源域名
- 改动后验证 → `npm run ci`（含覆盖率门槛 + 架构边界 + 真实扩展 E2E + axe）；纯 Domain/Protocol 改动优先跑 `tests/unit/domain/` / `tests/unit/protocol/`
