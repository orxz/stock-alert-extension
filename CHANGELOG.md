# 更新日志

## Unreleased

### 新增
- **跨浏览器支持（Edge + Chromium 系）**：评估确认 Edge / Brave / Opera / Vivaldi 均为 Chromium 内核，当前扩展所用 MV3 API（runtime / storage.local+session+onChanged / alarms / action，权限仅 storage + alarms）零代码改动即可运行。新增 `tests/e2e/cross-browser.spec.ts` 跨浏览器冒烟（bootstrap → seed 渲染 → 切分组 view 不变量 → 增删股票写回）；`launchBuiltExtension` 参数化 `channel`（`E2E_CHANNEL` 环境变量驱动，默认 chromium）；Playwright 新增 `edge` project（msedge channel）；CI 安装 msedge 并跑跨浏览器冒烟守护 Chromium 系分叉；`validate-manifest.mjs` 断言 manifest 不含 `browser_specific_settings`（Firefox 专有，范围外）；上架流程文档见 `docs/multi-browser-publishing.md`

### 变更
- **默认视图改为网格**：`DEFAULT_BOARD_CONFIG.viewMode` 由 `list` 改为 `grid`——全新用户打开即一屏卡片。深色主题本就是默认（`popup/main.ts` 只在 `localStorage.uiTheme === 'light'` 时转浅色，不跟随系统），本次一并由 E2E「fresh profile」用例锁死「深色 + 网格」这一首屏契约
- 已保存过视图偏好的用户不受影响：`boardConfig` 有该分组条目时读用户自己的选择，默认值只用于缺失时回退
- 断言表格结构的 E2E 改为显式声明视图（新增 `listBoardConfig()` 夹具）——此前它们依赖全局默认值，默认一改就集体变红
- 商店素材首图改为网格视图并去掉种子里写死的 `boardConfig`，使第一张截图就是真实首屏

---

## v2.0.1 — 列设置修复与详情面板丰富

### 变更
- **「多选」改名「管理持仓」**：旧名描述的是交互手段（能勾选多行），不是用户来这里要办的事——该模式的出口是全选 / 移动到分组 / 移除，即成批管理自选持仓。按钮可见文案与 `aria-label` 统一为「管理持仓」，`data-action` 改为 `manage-holdings`，批量工具栏的 `aria-label` 改为「持仓管理」、取消按钮改为「退出持仓管理」——读屏用户从入口到工具栏听到的是同一个词。420px 下实测：按钮固定 78×28 且位置不随分组数变化（标签栏内部滚动吸收压力），8 分组时仍不溢出

### 修复
- **列设置面板排序**：代码/状态是名称列副标题、不参与列重排——面板中它们的 ↑↓ 按钮禁用并固定到列表尾部，消除「移动副标题却毫无反应」的困惑；主列排序实时生效
- **列设置在卡片视图生效**：网格/卡片视图按列设置显隐代码/状态/现价/涨跌幅/成交额，卡片新增成交额展示（状态行右侧、弱色等宽）
- **列取消不再弹回**：锁定列收敛为只有「名称」——它固定显示在列表最前且不进入设置面板（用户无法取消它，也就不会遇到取消即弹回）；现价/涨跌幅/成交额/代码/状态均可自由显隐并持久化
- **列表名称列宽度收敛**：股票列从吃掉全部剩余空间（420px 面板中约 174px）改为固定 100px 设定（实际约 121px，占 29%），数字列相应加宽更易读；「代码·状态」副标题实测无截断
- **报错信息友好化**：新增展示层错误映射（`error-messages.ts`）——错误视图、行情状态条、toast、对话框错误不再透出英文技术文案（`eastmoney HTTP 403`、`internal error` 等），按结构化错误码优先、message 特征次之映射为中文提示（网络/超时/行情服务/搜索/存储/版本冲突等），未分类一律回退中文兜底
- **删除当前分组自动回退「全部」**：`currentGroupId` 新增不变量守护——`bootstrap/confirmed` 与 `mutation/confirmed` 落地 userData 时，若当前分组已不存在（被删除 / uncertain 对账后消失），自动切回「全部」并清空选中集；删除最后一个自定义分组后不再显示空列表
- **验收修复（代码审查后）**：① 对话框搜索清空时经 `dialogReset` 递增 generation，作废在途响应（旧关键词结果不再复活到空查询）；② 成交额 <100 万回退「X万」，≥100 万仍为亿且保留两位小数（400 万 → `0.04亿`），不再出现「0.0亿」读作零成交；③ 悬停详情浮层在滚动容器底部自动向上翻转（表格行/卡片按可视区判定加 `is-flipped`），最后几行的详情不再被裁剪；④ rename-group 对话框补齐分组列表，重名提前校验恢复生效；⑤ 列设置面板最后一个主列的 ↓ 禁用（不再跨入副标题区导致「点了没反应」）；⑥ mutation 落地后被移出当前分组的选中项自动剔除（选中集 ⊆ 可见集不变量补全）；⑦ 错误分类正则收紧为 `\bsearch\b`（research 等含子串单词不再误判）
- **验收修复（实网核对后）**：① 东财 f51/f52 **不是**涨停价/跌停价——实网核对发现该 endpoint 上它们是无关量纲（茅台 2715 亿、平安银行 0），照搬会把「涨停价」渲染成 `271524528742.40`、`0.00`；已从请求字段与解析中移除，主源缺失即显示 `--`（原单测 fixture 手写 `f51: 1650` 把错误假设固化，任何 mock 测试都无法证伪）；② `选中集 ⊆ 可见集` 不变量补齐到 bootstrap 对账路径——批量删除超时经 `app:bootstrap` 落地权威快照时，已删除的选中项此前不会被剔除，批量工具栏仍为其计数

### 新增
- **详情面板丰富**：悬停列表行/卡片的详情数据从 5 项扩展到 16 项——新增成交额、涨跌额、换手率、振幅、量比、市盈率、市净率、总市值、流通市值、涨停价、跌停价；面板改双栏布局（8 行 × 2 项）
- **成交额单位以亿为主**：表格成交额列、卡片与详情面板优先显示「X.X亿」（≥1 万亿升级为「X.X万亿」）；≥100 万保留两位小数的亿（400 万 → `0.04亿`），<100 万才回退「X万」——否则两位小数的亿会显示 `0.00亿`，读作零成交
- **行情字段扩展**：东财主源 fields 请求 f7/f8/f9/f10/f20/f21/f23；腾讯备源解析 [38][39][43][44][45][46][47][48][49]；市值统一为元口径（腾讯亿→元换算）；涨停/跌停价以源数据为准，缺失显示 `--`；价格隐藏时涨停/跌停与今开/最高等同为 `****` 掩码
  - **涨停/跌停仅腾讯源提供**：东财批量接口 `ulist.np/get` 不提供涨跌停价——该 endpoint 上 f51/f52 装的是别的量纲（实测 sh600519 返回 2715 亿、sz000001 返回 0），仅逐只的 `stock/get` 上才是涨跌停。改用逐只接口会让 500 只自选股从 1 次请求变成 500 次，故主源该两项按既有约定显示 `--`

---

## v2.0.0 — 基础架构重建

> **基础架构重建，不新增提醒功能。** 用户数据（schema v2）与权限保持不变，v1.3.0 发布包可安全回滚。

### 架构升级
- **TypeScript + 原生 ES Modules**：所有运行时 JavaScript 改为 TypeScript 源码，`tsc` 输出原生 ESM；`module: ES2022`、`target: ES2022`、`moduleResolution: Bundler`、`strict: true`
- **分层架构与 Project References**：Domain / Protocol / Application / Infrastructure / Background / Popup 六层，依赖只能由外向内；架构检查脚本拒绝反向 import 和循环依赖
- **单一 StorageCoordinator**：`chrome.storage.local` 的唯一业务调用者和唯一写入队列；用户数据、缓存写入、缓存删除、一致性读取均进入同一串行临界区
- **内容 revision 乐观并发**：`userDataRevision` 是规范化 `groups + watchlist + boardConfig` 的 SHA-256 摘要；所有写命令携带 `expectedRevision`，冲突返回 `CONFLICT` 不执行写入
- **版本化 RPC v2**：单一注册表 `rpcRegistry` 统一方法 / payload / result / 运行时校验；`requestId` 贯穿 Popup、Router、Application、Repository；结构化错误码 + `retryable` 标记
- **不可变 Popup Store**：纯 Reducer 是唯一状态写入口；Selector 派生 ViewModel；Command 负责 RPC / 副作用 / uncertain 对账（超时 → bootstrap 对账 → desired-state predicate → 安全重试）
- **Light DOM Web Components**：组件只接收 ViewModel、发出语义事件；`connectedCallback` 使用每次连接新建的 `AbortController`；keyed update 保留节点身份、焦点、滚动
- **可重试初始化屏障**：Service Worker listener 同步注册，handler 等待共享 `idle/running/ready` 三态屏障；失败回到 `idle` 让下一事件重试
- **持久化退避**：退避状态写入 `chrome.storage.session`，Service Worker 重建后恢复；空自选股不请求网络也不改变退避
- **安全 Alarm 调度**：每次任务开始前创建最迟安全 Alarm，结束后替换为精确一次性 Alarm；每次激活执行 `ensureAlarm`

### 数据与权限保证
- **schema v2 不变**：`groups` / `watchlist` / `boardConfig` / `quoteCache:<code>` 持久化语义不变；不执行破坏性迁移
- **权限不变**：`storage` + `alarms`；host permissions 仍为 `hq.sinajs.cn` / `push2.eastmoney.com` / `searchapi.eastmoney.com`
- **行情语义不变**：`price > 0`、东财主源 + 新浪备源、50 只/批、4 秒 Provider 超时、8 秒总 deadline、fresh `<30s`、cached `30s–7d`、退避 `30s→2m→5m`；缺失行情绝不生成模拟价格
- **回滚兼容**：v2.0.0 写出的 schema v2 数据可被冻结的 v1.3.0 发布包安全读取；v2.0.0 不持久化只有新版本才能解释的必需字段

### 质量门禁
- **架构检查**：TypeScript Compiler API 解析 import graph，拒绝反向跨层 import 和循环依赖
- **覆盖率**：全局 `src/**` lines/statements/functions 90% + branches 85%；Domain/Protocol/Storage/Reducer 95% + 90%
- **无障碍**：axe-core 零 critical/serious；44×44px 触控目标；WCAG 2.1 AA 对比度；完整键盘操作等价；`prefers-reduced-motion`
- **性能**：20 分组 / 500 股票夹具；bootstrap p95 ≤ 250ms；首次可交互 p95 ≤ 500ms；缓存 ViewModel + keyed DOM 更新 p95 ≤ 100ms
- **确定性构建**：两次清洁构建产生字节一致 ZIP；ZIP 只含运行时文件（无源码 / 测试 / map / 文档）；200 KB 提醒 / 500 KB 硬限制
- **回滚验证**：`verify-rollback.mjs` 验证 v1.3 → v2 写入 → v1.3 回读 → v2 再升级的数据兼容性

### 变更文件
- **新增**：`src/`（84 个 TypeScript 源文件）、`extension/`（manifest.json + popup.html + styles + icons + privacy）、`tsconfig*.json`（4 个）、`scripts/build-extension.mjs` / `check-architecture.mjs` / `check-runtime-imports.mjs` / `verify-deterministic-build.mjs` / `verify-rollback.mjs`、`tests/fixtures/v1.3/`（冻结契约）、`tests/fixtures/capacity/`
- **删除**：`background.js` / `popup-actions.js` / `popup-bridge.js` / `popup-render.js` / `popup-state.js` / `popup.js` / `quote-format.js` / `quote-service.js` / `quotes.js` / `router.js` / `stock-utils.js` / `storage.js`（v1 运行时）及对应 v1 测试
- **修改**：`package.json`（v2 scripts）、`eslint.config.mjs`、`playwright.config.mjs`、`scripts/validate-manifest.mjs` / `package-extension.mjs` / `check-bundle-size.mjs` / `capture-store-assets.mjs`

---

## v1.3.0 — 架构与体验

### 架构升级
- Service Worker 成为行情数据唯一所有者，Popup 通过 RPC 消息总线请求
- 新增 `router.js` RPC 路由器（14 个 action）
- 新增 `popup-bridge.js` RPC 客户端（含超时保护）
- popup.js 拆分为 5 个模块：bridge / state / render / actions / entry

### 代码质量
- 提取 `quote-format.js` 共享格式化模块，消除 Popup/Background 重复
- CSS 设计令牌系统（CSS Custom Properties）
- 协议契约测试：Bridge ↔ Router 一致性验证

### 无障碍 (WCAG 2.1 AA)
- ARIA 标记：tablist、region、dialog、alert、status
- 键盘导航：分组 Tab 箭头键、卡片 Enter 置顶
- 颜色对比度修复：次要文本、涨跌色加深至 4.5:1
- 触控目标扩展至 44px
- `prefers-reduced-motion` 支持

### 可观测性
- **后台行情链路诊断**：Service Worker 行情刷新从黑盒变为可追踪——通过共享 `runId` 将「触发→边界→恢复」三段关联输出到 console
- **结构化诊断事件**：QuoteService 发出 `provider-failed` / `refresh-empty` / `refresh-deferred` / `refresh-done` 四种事件（含 provider 名、错误分类、counts、退避状态）；Storage 发出 `cache-read/write/delete-failed` 三种缓存失败诊断并 rethrow 原错误
- **触发来源标注**：`updateBadgeAndTitle` 标注 5 种触发来源（installed / startup / alarm / storage-change / retry）
- **覆盖率门禁扩展**：`background.js` 纳入 c8 单测覆盖率门禁（lines 91.5% / branches 87.9%）
- **智能体入口文档**：新增 `AGENTS.md`，涵盖入口文件、命令面、核心不变量与风险路由

---

## v1.2.1

### 新增功能
- **全局分组语义**：「全部」改为计算视图，股票加入任意自定义分组后始终出现在「全部」，`groupIds` 只保存自定义分组
- **本地数据迁移 schema v2**：自动、幂等迁移旧版数据，迁移前保留一份本地备份；支持旧版扁平列表还原
- **可信行情状态**：弹窗如实区分「实时 / 缓存 / 缺失」，缓存显示「旧 HH:MM」，缺失显示 `--`；行情服务失败时保留 7 天内缓存
- **弹性行情服务**：请求 4 秒超时、每批 50 只、东财主源 + 新浪补源、7 天缓存、失败退避（30s/2m/5m）
- **自适应刷新**：弹窗盘中 10 秒 / 盘外 5 分钟；后台盘中 30 秒 / 盘外 5 分钟（一次性 alarm）
- **缓存感知 Badge**：缓存行情保留数字但角标灰显，Tooltip 追加「已过期 HH:MM」；无可用行情时灰显 `--`
- **确定性质量门禁**：Playwright 真实扩展 E2E（9 个场景）+ GitHub Actions CI + 覆盖率门禁
- **确定性发布**：固定 mtime 的 ZIP 打包脚本 + SHA-256 输出 + 真实弹窗商店截图

### 缺陷修复
- **存储写入竞态**：所有用户数据修改改为串行写入队列，消除并发 read-modify-write 丢失更新
- **行情缓存独立化**：缓存改为按代码独立键存储，损坏条目自动忽略并清理
- **零价格行情拒绝**：新浪源不再把开盘价当作停牌股票的现价兜底，零价行情一律按缺失处理
- **孤儿缓存清理**：行情缓存只允许写入当前自选股，删除股票后迟到的刷新写入不会复活缓存键
- **后台 Tooltip 真实性**：缓存读取覆盖全列表，前 5 只缺失但后续股票有缓存时不再误报「暂无可用行情」
- **弹窗细节修正**：更新时间统一按 Asia/Shanghai 显示；空自选股手动刷新提示「暂无自选股」而非「行情已刷新」
- **错误文案修正**：隐私政策如实披露向行情服务商发送股票代码，移除 Demo 兜底与绝对化「不上传任何数据」表述

### 变更文件
- 新增 `stock-utils.js`、`quote-service.js`、`scripts/package-extension.mjs`、`scripts/capture-store-assets.mjs`、`tests/e2e/`、`.github/workflows/ci.yml`、`LICENSE`
- 重构 `storage.js`（schema v2 + 串行队列 + 行情缓存）、`quotes.js`（移除 Demo）、`background.js`（自适应 + 缓存灰显）、`popup.js`（真实状态 + 操作锁）
- `manifest.json` 版本 1.2.0 → 1.2.1

---

## v1.2.0

### 新增功能
- **底部状态栏**：显示行情更新时间（刚刚更新 / N秒前 / N分钟前 / HH:MM），每秒自动更新
- **手动刷新按钮**：底部状态栏新增刷新图标，点击立即拉取行情，按钮旋转动画 + toast 反馈
- **图标按排序联动**：插件图标 badge 默认显示当前排序配置下排在第一只股票的涨跌幅，不再固定为置顶股票
- **tooltip 同步排序**：hover tooltip 显示排序后的前 5 只股票，与看板顺序一致

### 缺陷修复
- **置顶二次崩溃**：修复取消置顶后 `stock.pinned` 被删除导致再次置顶时 `TypeError` 崩溃
- **拖拽跨区乱序**：修复手动拖拽排序时置顶区/非置顶区共用连续编号导致的跨区拖拽顺序错乱
- **置顶位置错误**：修复置顶/取消置顶后的股票不能正确排到目标分区末尾的问题
- **多分组写入竞态**：修复 `_flushBoardSave` 中多分组并发写入 boardConfig 时的 lost-update 竞态
- **空值保护**：storage.js 所有 `delete stock.pinned/manualOrder[groupId]` 操作增加空值前置保护

### 性能优化
- **后台行情按需拉取**：manual/addedAt/name 排序时仅拉取 badge+tooltip 所需的最多 6 只行情（原为全量拉取）

### 变更文件
- `manifest.json` — 版本号 1.1.0 → 1.2.0
- `popup.html` — 版本号 + 底部状态栏 UI（更新时间 + 刷新按钮 SVG）
- `popup.css` — 新增 .status-bar / .refresh-btn / .spinning / @keyframes spin 样式
- `popup.js` — 更新时间显示 / 手动刷新 / 置顶重算优化 / 分区独立编号 / 排序保护 / 配置写入防竞态
- `storage.js` — togglePin 崩溃修复 / 空值保护 / setManualOrder 双模式支持
- `background.js` — sortStocks 排序函数 / 按 boardConfig 选取 badge 股票 / 按需拉取行情

---

## v1.1.0

### 新增功能
- 多市场支持：科创板（688/689）、北交所（920/830/430）
- 代码搜索 API 补全（东方财富搜索建议接口）

### 缺陷修复
- 搜索防抖 + 序列号防竞态
- 确认弹层键盘支持（Escape/Enter）
- 添加股票自动前缀补全

---

## v1.0.1

### 缺陷修复
- 价格隐藏按钮切换状态修复
- 列表虚拟滚动 >50 只启用

---

## v1.0.0

### 首个正式版
- 自选股分组管理（最多 20 组）
- 实时行情（东方财富 + 新浪双数据源 + Demo 兜底）
- 网格/列表双视图
- 拖拽排序与置顶
- 自定义列（12 字段）
- 智能搜索补全
- 价格隐藏
- 隐私合规（数据仅存 chrome.storage.local）
- 配置写入防抖（200ms）
