# AGENTS.md — 股票提醒助手（Chrome 扩展，Manifest V3，v2.0.1 TypeScript/ESM）

新会话从本文件起步。本文档是 **Qoder / 通用 Agent** 的入口，也是**开发规范（核心边界 / 不变量 / 风险路由 / 命令面 / 验证纪律）的唯一权威**；整体架构概览（分层图 / 数据流）见 [docs/项目架构.md](docs/项目架构.md)；Claude Code 用户入口见 [CLAUDE.md](CLAUDE.md)。

## 入口文件

| 文件 | 角色 |
|------|------|
| `extension/manifest.json` | 扩展清单（MV3）：`action.default_popup` = popup.html，`background.service_worker` = `runtime/background/main.js`（`type: "module"`）；权限仅 `storage` + `alarms`；host_permissions 覆盖三个数据源域名（push2.eastmoney.com / searchapi.eastmoney.com / qt.gtimg.cn） |
| `extension/popup.html` | 弹窗 UI 入口：`<stock-app hidden>` + `#fatal-fallback` + `<script type="module" src="runtime/popup/main.js">`；链式加载 `tokens → base → layout → controls → board → overlays → accessibility`（7 个分域样式表，`components.css` 已在 v2 视觉重建中拆解） |
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
- `npm run test:build`：`tests/unit/build/**/*.test.mjs`——构建产物 / 架构闸 / 容量夹具 / **商店素材规格**（无需浏览器）
- `npm run test:e2e`：Playwright 加载 `build/extension/` 真实扩展 E2E
- `npm run test:a11y`：axe-core 无障碍扫描
- `npm run ci`：check + test:unit + test:critical-coverage + test:component + **test:build** + test:e2e + test:a11y
- `npm run test:release`：`tests/release/**`——释放包允许列表。前置条件是**已打包**，故只进 `release:verify`，不进 `ci`
- `npm run release:verify`：ci + test:performance + npm audit + verify-deterministic-build + capture:store + package:extension + check:bundle + test:release
- `npm run capture:store`：生成商店素材（3 张 1280x800 截图 + 440x280 + 1400x560），落 `store-assets/`
- `npm run test:live`：实网行情冒烟（**不进 ci**，依赖第三方端点可达性）

> **新增测试文件必须落进某个会跑的 glob。** `tests/unit/build/` 曾有 4 个 `.test.mjs`
> 长期不被任何门禁执行——`test:unit` 的 glob 只匹配 `*.test.ts`。目录即前置条件：
> 需要打包产物的放 `tests/release/`，其余放 `tests/unit/build/`。

## 核心边界（不变量）

- **存储**：`StorageCoordinator`（`src/infrastructure/storage/storage-coordinator.ts`）是 `chrome.storage.local` 的唯一业务调用者和唯一写入队列；所有用户数据/缓存读写进入同一串行临界区。schema v2 由 `groups` / `watchlist` / `boardConfig` / `quoteCache:<code>` 组成；`g_all`（「全部」）是计算视图，不存储成员标记。`userDataRevision` 是规范化 `groups + watchlist + boardConfig` 的 SHA-256 摘要，不作为独立 key 持久化。schema 迁移走 `migrateToV2`（幂等）并备份到 `migrationBackup:v1.2.1`（首次写入不覆盖）
- **行情**：`QuoteProvider`（`src/infrastructure/quote-providers/`）是纯传输层（东财主源 + 腾讯备源），只返回真实远端数据；`QuoteService`（`src/application/quotes/`）负责编排（4s Provider 超时、8s 总 deadline、50 只/批、并发 2、fresh `<30s` / cached `30s~7d` / 超期删除、失败退避 `30s→2m→5m` 持久化到 `chrome.storage.session`）；`price > 0` 才视为可用行情；缺失时保留未过期缓存，**绝不生成模拟价格**；空自选股不请求网络也不改变退避状态
- **代码规范**：股票代码带市场前缀 `sh` / `sz` / `bj`，统一经 `src/domain/stock.ts` 的 `normalizeStockCode` 规范化
- **RPC v2**：`src/protocol/registry.ts` 是唯一的 RPC 方法/payload/result/validator 注册表（13 个方法）；所有写命令是幂等最终态命令并携带 `expectedRevision`；冲突返回 `CONFLICT` 不写入；`requestId` 贯穿全链路
- **Popup Store**：`src/popup/store/reducer.ts` 是 `AppState` 的唯一写入口（纯函数）；`domain.boardConfig` 是持久偏好的唯一真相；超时写入进入 uncertain 状态，经 bootstrap 对账确认后更新——绝不盲目回滚
- **view 不变量**：`currentGroupId` 必须指向存在的分组，且**选中集 ⊆ 当前分组可见集**。替换 `userData` 的路径有**两条**——`mutation/confirmed` 与 `bootstrap/confirmed`（写命令超时 → uncertain → `app:bootstrap` 对账），两条都必须过 `settleView`。只在 mutation 分支收敛会让批量工具栏为已删除的股票留计数
- **默认形态**：全新用户打开即 **深色 + 网格**。两处默认值——`DEFAULT_BOARD_CONFIG`（`src/domain/portfolio.ts`，唯一定义处）与 `src/popup/main.ts` 的 `initialTheme`（仅当 `localStorage.uiTheme === 'light'` 才转浅色，不读 `prefers-color-scheme`）。由 `tests/e2e/preferences.spec.ts` 的「fresh profile」用例守护
- **行情字段绑定 endpoint，不可跨接口套用**：东财 `f*` 字段的含义**随 endpoint 变化**——`f51/f52` 只在逐只的 `stock/get` 上是涨停/跌停价，在本项目使用的批量接口 `ulist.np/get` 上是无关量纲（实测茅台 2715 亿、平安银行 0）。新增字段前必须拿真实接口比对已知真值，不能只照字段表；provider 缺该数据时保持 `undefined`，展示层渲染 `--`
- **商店素材规格**：`store-assets/` 的截图必须是 1280x800 或 640x400、小图块 440x280、顶部图块 1400x560，且为 24 位无 alpha PNG。由 `tests/unit/build/store-assets.test.mjs` 守护——商店只在**上传那一刻**报「图片尺寸不正确」，没有门禁就会一直躺着一批不能用的图
- **行高契约**：`TABLE_ROW_EXTENT`（`stock-table.ts`）必须等于 `tokens.css` 的 `--row-h`，否则虚拟滚动的 spacer 与真实行高逐行错位。由组件测试直接比对两个真实来源双向锁死
- **调度**：刷新间隔由市场状态计算——盘中 popup 10s / 后台 alarm 30s，盘外 5 分钟；每次任务先创建安全 Alarm（5 分钟），结束后替换为精确 Alarm；每次 SW 激活执行 `ensureAlarm`

## 风险路由（改哪里、注意什么）

- 改行情逻辑 → `src/infrastructure/quote-providers/`（传输/解析）或 `src/application/quotes/quote-service.ts`（编排）；退避状态持久化到 `chrome.storage.session`，SW 重建后恢复
- 改存储 schema/字段 → `src/infrastructure/storage/sanitize-v2.ts` + `migration-service.ts` + `storage-coordinator.ts`：必须保持 v1.2.1→v2 兼容，所有写操作走 Coordinator 单队列
- 新增/修改 RPC 方法 → `src/protocol/registry.ts`（单一注册表）+ `src/background/rpc-handlers.ts`（exhaustive handler 表）两端同步；payload 用注册表内联 validator 校验
- 改 Popup 状态流 → `src/popup/store/reducer.ts`（唯一写入口）+ `selectors.ts`；组件只接收 ViewModel、发出语义事件，不访问 Store/RPC/Repository
- 改权限/入口/域名 → `extension/manifest.json`；host_permissions 只允许上述三个数据源域名
- 改默认视图/主题 → `DEFAULT_BOARD_CONFIG` + `src/popup/main.ts`；**断言表格结构的 E2E 必须显式声明视图**（`listBoardConfig()` / `gridBoardConfig()`），依赖全局默认值的用例会在默认一改时集体变红
- 改商店素材/文案 → `scripts/capture-store-assets.mjs` + `store-assets/`；素材是随版本提交的产物，改完跑 `npm run capture:store` 并让 `test:build` 校验规格。文案只许描述**源码中真实存在**的能力：本扩展**没有价格提醒功能**（「股票提醒助手」只是产品名），备源是**腾讯**不是新浪，可配置列是 **5** 个，自定义分组上限 **19**（+1 个默认）
- 改跨浏览器支持（Edge / Chromium 系）→ `tests/e2e/extension-fixture.ts`（`channel` 参数化 + `E2E_CHANNEL` 环境变量）+ `tests/e2e/cross-browser.spec.ts`（Edge 冒烟）+ `playwright.config.mjs`（`edge` project）；上架流程见 `docs/multi-browser-publishing.md`。Chromium 系零代码改动，manifest 不含 `browser_specific_settings`（由 `validate-manifest.mjs` 断言）
- 改动后验证 → `npm run ci`（含覆盖率门槛 + 架构边界 + 真实扩展 E2E + axe）；纯 Domain/Protocol 改动优先跑 `tests/unit/domain/` / `tests/unit/protocol/`

## 验证纪律（两次踩坑换来的）

1. **mock 不能替代实证。** 跨进程/网络边界的契约，必须有一次拿真实响应做的核对。
   v2.0.0 的 P0（备源永久 403）被一条恒真断言掩盖；v2.0.1 的 P1（f51/f52 不是涨跌停）
   被手写 fixture 固化成「被测事实」——**任何 mock 测试都无法证伪写错的 mock**。
2. **门禁必须真的会跑。** 断言存在 ≠ 断言执行。已发生三次：a11y 门禁从未进 CI、
   `tests/unit/build/` 四个文件不被任何 glob 匹配、控件改名后 WCAG 尺寸断言因
   `count()===0 → continue` 静默跳过。**选择器落空要抛错，不要 skip。**
3. **写死的期望值会掩盖真正的契约。** `build-extension.test.mjs` 曾写死 `'2.0.0'`，
   版本一升就报错；真正该断言的是「构建产物版本 == 源 manifest 版本」。
   期望值应指向唯一真相，而不是复制一份。
4. **改动后先问「这条断言现在还会失败吗」。** 新增回归测试要红→绿验证过；
   改默认值/改名后，要确认原本守护它的用例仍然指向新的正确值。
5. **CI workflow 必须覆盖 `npm run ci` 的全部门禁。** AGENTS.md 声明的命令面是
   门禁的权威定义；`ci.yml` 是门禁的执行体。已发生过：AGENTS.md 声明了 7 个门禁
   但 `ci.yml` 实际只跑 3 个（test:critical-coverage / test:component / test:build /
   test:a11y 全漏）。**新增 npm 测试脚本时，必须同步更新 `ci.yml` 与 `release.yml`**，
   并检查它是否真的落进了某个会跑的 glob。
