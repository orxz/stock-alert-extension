# 股票提醒助手 v2.x · UI 与交互整体焕新 — 设计文档

**日期：** 2026-08-04
**状态：** 待评审
**范围：** Popup 弹窗的视觉主题、布局结构、信息密度、顶部操作区、动效与加载体验
**关联计划：** `docs/superpowers/plans/2026-08-03-v2.0.0-foundation-rebuild.md`（v2 基线，本文档不改变其架构/存储/协议约束）

---

## 1. 目标

在 v2.0.0 已建成的架构（TypeScript/ESM、不可变 Store、Light DOM Web Components、单一 StorageCoordinator、RPC v2）之上，对 Popup 做一次**整体焕新**：

1. 引入**深色交易终端**主题为默认，并保留**浅色主题切换**。
2. 将 Popup 固定为 **420×560**（在用户要求的 400–600px 区间内），改为「固定高度 + 行情区内部滚动」，消除当前内容溢出 1831px 的问题。
3. 顶部操作区重构为 **A1 · 图标 + 文字标签**（浅色/价格/多选/添加）。
4. 行情区信息密度提升：列表补齐**涨跌额 + 成交额**列，完整呈现 fresh/cached/missing 三态。
5. 视觉质感提升：分层投影、渐变底、等宽数字（tabular-nums）、行悬停微光、置顶高亮、骨架屏加载。

**不改变：** 行情语义（`price > 0`、红涨绿跌、绝不模拟价格）、权限、schema v2 数据结构、RPC 契约、回滚保证、覆盖率门禁。

---

## 2. 硬约束（来自项目，必须遵守）

| 约束 | 来源 | 对本设计的影响 |
|------|------|----------------|
| 零运行时第三方依赖 | Global Constraint | 图标用**内联 SVG**，禁止图标字体/网络字体；仅系统字体栈 |
| 44×44px 触控目标 | a11y 发布要求 | 操作区按钮 ≥44px；行情行可略矮（行内按钮达 44px） |
| WCAG 2.1 AA 对比度（4.5:1 正文 / 3:1 大字·UI） | a11y 发布要求 | 深/浅两套 token 逐一校验对比度 |
| 绝不模拟价格 | 行情不变量 | cached/missing 态只呈现真实缓存或 `--`，无骨架假数字 |
| schema v2 冻结 + v1.3 回滚读回 | Task 20 | **主题偏好禁止进入 BoardConfig/userData**（参与 revision 摘要） |
| 单一 StorageCoordinator 写入 | 存储不变量 | 主题持久化若走 storage，须经 Coordinator |
| Popup Store 是唯一写入口 | reducer 纯函数 | 主题切换走 Store action，组件只发语义事件 |
| reduced-motion | a11y 发布要求 | 所有 transition/animation 在 `prefers-reduced-motion` 下归零 |

---

## 3. 关键设计决策

### 3.1 主题：深色交易终端为默认 + 浅色切换

- **深色为默认**（专业行情终端气质，最贴合股票场景），浅色通过顶部按钮切换。
- 主题通过 **CSS 自定义属性（design tokens）** 实现：`:root[data-theme="dark"]` 与 `:root[data-theme="light"]` 各一套变量，组件样式只引用变量。
- **持久化落点（关键）**：主题**不进入** `BoardConfig`/`UserData`，也**不进入** `chrome.storage.local`。理由：
  - `BoardConfig` 参与 `userDataRevision`（SHA-256 摘要）与 v1.3 `readWithV13Rules` 回滚读回；加入主题字段会污染摘要、破坏回滚兼容性。
  - 主题是**纯展示偏好**，与用户数据无关，不需要进入受 Coordinator 保护的业务数据临界区。
  - **决策**：存于 Popup 的 `window.localStorage`，key `uiTheme`（值 `'dark' | 'light'`），默认 `'dark'`。
    - `localStorage` 与 `chrome.storage.local` 完全隔离 → 对迁移、revision 摘要、v1.3 回滚读回**零影响**，`verify-rollback.mjs` 与确定性构建不受任何改动。
    - 不触碰 `StorageCoordinator`，无需改 `sanitize-v2` / `computeUserDataRevision`。
    - 主题仅 Popup 呈现层使用（Service Worker 不需要），`localStorage` 作用域足够。

### 3.2 布局：固定 420×560 + 内部滚动

垂直分区（总高 560px）：

| 区块 | 高度 | 内容 | 滚动 |
|------|------|------|------|
| Header | 44px | 标题 + A1 操作按钮组 | 否 |
| Group Tabs | 38px | 分组标签，超出横向滚动 | 横向 |
| Toolbar | 42px | 搜索 / 排序 / 视图切换 / 列设置 | 否 |
| **行情区** | ~404px | 列表或网格 | **唯一纵向滚动区** |
| Status Bar | 32px | 最新/缓存/缺失计数 + 时间 + 刷新 | 否（固定底部） |

- `body` / `stock-app` 固定 `width:420px; height:560px`，`overflow:hidden`。
- 行情区 `overflow-y:auto`；状态栏固定在底部，**刷新按钮永远可见**（修复现状「状态栏位于 1779px 飞出首屏」）。
- 顶部三区（header/tabs/toolbar）压缩为单行，修复现状「工具栏折两行、搜索框被压到 96px」。

### 3.3 顶部操作区：A1 · 图标 + 文字标签

4 个按钮，从左到右（次要 → 主操作）：

| 按钮 | 图标（内联 SVG） | 文字标签 | 行为 | 事件 |
|------|-----------------|----------|------|------|
| 主题 | 半圆（明暗） | 「浅色」⇄「深色」随状态变 | 切换 `data-theme` | 新增 `theme-change` |
| 价格 | 眼睛 | 「价格」 | 掩码 ⇄ 显示 | 现有 `preferences-change{priceHidden}` |
| 多选 | 勾选框 | 「多选」 | 进入/退出多选 | 现有 `selection-mode-change` |
| 添加 | 加号 | 「添加」（品牌色填充） | 打开添加对话框 | 现有 `dialog-open-request{kind:'add-stock'}` |

- 每个按钮 = 图标 + 两字标签，零学习成本；主题按钮文字随状态变。
- 「添加」为视觉主操作：品牌色填充底。
- 激活态（多选开/价格隐藏开）用 `aria-pressed` + 品牌色背景 + 加粗描边（沿用现有「不只靠颜色区分」原则）。
- 图标统一 24px viewBox 线性风格，`stroke="currentColor"`，随主题变量变色。

### 3.4 行情区信息增强

**列表视图**（默认）：网格列 `名称 / 最新价 / 涨跌幅 / 涨跌额 / 成交额 / 置顶`
- 表头行（10px 灰字）。
- 数字列右对齐，全部 `tabular-nums`。
- 三态：
  - fresh：绿点前缀（状态栏）+ 正常色。
  - cached：名称下显示「缓存 N分前」（`staleLabel`），行降透明度 0.92。
  - missing：价格/涨跌显示 `--`，灰色；名称下红色「暂无行情」。
- 置顶行：左侧 3px 金色边条 + 行背景微亮。

**网格视图**：2 列卡片，卡片含 名称 / 大号价格 / 涨跌幅 chip / 成交额。置顶卡片金色描边。

**字段来源确认**：`Quote` 已含 `price/change/changePercent/amount`（见 `src/domain/quote.ts`），涨跌额与成交额**数据已存在**，仅需在 ViewModel 与组件层补齐展示；`SortField` 已支持 `change`/`amount` 排序。

### 3.5 视觉设计系统（tokens）

**深色（默认）：**
```
--bg: #0a0e15            --bg-grad: linear-gradient(180deg,#0d1220,#0a0e15)
--surface: #121722       --surface2: #1a2130   --surface3: #222b3d
--border: rgba(255,255,255,.07)  --border-strong: rgba(255,255,255,.12)
--text: #e9edf5          --text2: #96a0b5      --text3: #5f6a80
--up: #ff5b5b            --up-soft: rgba(255,91,91,.12)
--down: #2fd18c          --down-soft: rgba(47,209,140,.12)
--brand: #4d9fff         --brand-soft: rgba(77,159,255,.15)
--gold: #e8b341
```
**浅色：**
```
--bg: #f2f4f8            --bg-grad: linear-gradient(180deg,#ffffff,#f2f4f8)
--surface: #ffffff       --surface2: #eef1f6   --surface3: #e3e8f0
--border: rgba(20,30,55,.08)  --border-strong: rgba(20,30,55,.14)
--text: #1c2333          --text2: #5c6779      --text3: #9aa3b2
--up: #d93025            --up-soft: rgba(217,48,37,.09)
--down: #0f8a4c          --down-soft: rgba(15,138,76,.09)
--brand: #2f6fbd         --brand-soft: rgba(47,111,189,.11)
--gold: #c98a12
```
- **红涨绿跌**（A 股惯例）：深色 `#ff5b5b`/`#2fd18c`，浅色 `#d93025`/`#0f8a4c`。对比度在各自背景上均 ≥4.5:1（实现时逐值校验，沿用 v2 现有 token 校验纪律）。
- 字体栈：`-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`（沿用现状，不引入网络字体）。
- 数字：全局 `font-variant-numeric: tabular-nums; font-feature-settings:"tnum" 1`。

### 3.6 动效与加载

- **价格更新闪烁**：行情刷新时，变化的价格短暂高亮（背景 fade，150–250ms），`reduced-motion` 下禁用。
- **骨架屏**：首次 bootstrap loading 时，行情区渲染灰色占位条（不含任何假数字/假价格），替代现状的纯文字「加载中」。
- **行悬停微光**：`hover` 背景过渡 0.16s。
- **主题切换过渡**：`background-color/color` 0.35s 过渡。
- 所有动效在 `prefers-reduced-motion: reduce` 下 `duration: 0s`（现有 `accessibility.css` 已覆盖，新增动效纳入同一 media query）。

---

## 4. 组件与代码改动清单

| 层 | 文件 | 改动 |
|----|------|------|
| 样式 | `extension/popup/styles/tokens.css` | 重写为双主题 token（`[data-theme]` 选择器） |
| 样式 | `extension/popup/styles/layout.css` | 固定 420×560 + 内部滚动 + 固定底部状态栏 |
| 样式 | `extension/popup/styles/components.css` | 组件样式迁移到 token；**顺带清理现有 217 行重复块**（App Dialog Host 与 Search Combobox 各重复一次） |
| 样式 | `extension/popup/styles/accessibility.css` | reduced-motion 覆盖新增动效 |
| 组件 | `src/popup/components/stock-header.ts` | A1 操作区：新增主题切换按钮 + 图标+文字；改发 `theme-change` |
| 组件 | `src/popup/components/stock-card.ts` / `stock-table.ts` | 补齐涨跌额/成交额列、三态呈现、等宽数字、价格闪烁 |
| 组件 | `src/popup/components/stock-board.ts` | 骨架屏 loading 态 |
| 组件 | `src/popup/components/quote-status.ts` | 固定底部样式（结构不变） |
| Store | `src/popup/store/state.ts` / `actions.ts` / `reducer.ts` | 新增 `theme` 字段（view 区或独立区）+ `theme-change` action |
| Store | `src/popup/store/selectors.ts` | 派生 `data-theme` 属性值 |
| ViewModel | `src/popup/view-models.ts` | `StockCardViewModel` 补 `change`(已有)展示文本、`amount` 展示文本、`displayChange` |
| RPC/存储 | 无 | 主题走 `localStorage`（见 3.1），不改 Coordinator/sanitize/revision/RPC |
| 入口 | `src/popup/main.ts` | bootstrap 时读主题偏好并设 `document.documentElement.dataset.theme` |

**架构边界不变**：组件仍只收 ViewModel、发语义事件；不直接访问 Store/RPC/Repository。新增 `theme-change` 事件经 AppShell 路由到 Store。

---

## 5. 无障碍

- 主题按钮：`aria-label="切换主题"`，文字标签随状态变，`aria-pressed` 反映当前态。
- 所有新增交互元素 ≥44×44px（行内置顶按钮达 44px）。
- 对比度：深/浅 token 逐值过 axe + 手动计算；红绿涨跌**不单独依赖颜色**（配 ▲/▼ 箭头 + 文字符号）。
- 骨架屏：`aria-busy`，无假数据。
- 键盘：主题按钮可 Tab 聚焦、Enter/Space 触发；焦点环 `focus-visible` 在双主题下均可见。
- 现有 axe 门禁（`test:a11y`，`RUN_A11Y=1`）必须保持零 critical/serious。

---

## 6. 测试策略

沿用项目既有门禁，新增针对性断言：

- **组件测试（happy-dom）**：主题切换发正确事件；A1 按钮 `aria-pressed`；涨跌额/成交额渲染；三态呈现。
- **reducer 单测**：`theme-change` action 纯更新；未知 action 返回同对象。
- **E2E（build/extension）**：
  - 主题切换后 `document.documentElement[data-theme]` 变化 + 持久化（重开 popup 保留）。
  - 固定 420×560：`getBoundingClientRect` 断言，状态栏在首屏可见。
  - 行情区内部滚动：内容溢出时 body 不产生纵向滚动。
- **a11y**：深/浅两态各跑 axe（`accessibility.spec.ts` 扩展双主题扫描）。
- **回归**：现有 37 个核心 e2e 必须全绿；行情语义（无模拟价格）不变。

---

## 7. 明确不做（Out of Scope）

- 不新增提醒/通知功能（v2 定位为基础架构重建）。
- 不改行情数据源、缓存策略、退避、调度。
- 不改 RPC 方法签名与 schema v2 结构。
- 不引入任何运行时依赖、图标字体、网络字体、打包器。
- 不改变 v1.3 回滚保证。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 主题偏好持久化触碰 revision/回滚 | 已决策走 `localStorage`（3.1），与 `chrome.storage.local` 完全隔离，无此风险 |
| 420×560 固定高度在小屏被 Chrome 裁剪 | Chrome popup 上限 600px 高，560 安全；`overflow:hidden` 防溢出 |
| 双主题对比度不达标 | 实现时逐 token 校验 + axe 双态扫描纳入门禁 |
| components.css 清理重复块引入回归 | 清理后跑全量 component + e2e 验证视觉与交互 |
| 等宽数字在某些系统字体缺失 | `font-feature-settings:"tnum"` 回退到 `tabular-nums`，系统字体栈均支持 |

---

## 9. 验收标准

1. Popup 固定 420×560，内容不溢出窗口；状态栏（含刷新）始终可见。
2. 深色为默认主题；顶部按钮可切换浅色；偏好持久化（重开保留）。
3. 顶部操作区为 A1（图标+文字）：浅色/价格/多选/添加，均可用且有 `aria-pressed`/文字反馈。
4. 列表视图含 涨跌额 + 成交额 列；三态（fresh/cached/missing）正确呈现；无模拟价格。
5. 数字等宽不抖动；价格更新有闪烁反馈（reduced-motion 下无）。
6. `npm run ci` 全绿；`RUN_A11Y=1` axe 双主题零 critical/serious；37 个核心 e2e 全绿。
7. v1.3 回滚（`verify-rollback.mjs`）与确定性构建不受影响。
