# v2.0.0 验收报告

- **日期：** 2026-08-06
- **分支：** `feature/v2.0.1-quote-reliability-and-perf`
- **范围：** 架构升级 + 视觉升级的全量深度审查
- **产品决策：** 版本号定为 2.0.0；**不提供回退到 v1.3 的路径**（相关验证资产已移除）

> 本报告取代 2026-08-04 那份基于 `3cb7fd9` 的旧验收。旧报告结论为「✅ 通过 /
> 无产品级回归」，但当时最重要的用户功能——**取到行情**——在生产中是坏的，
> 且所有门禁都是绿的。原因见 §3。

---

## 一、门禁结果

全部在本次审查的最终提交上实测；`npm run release:verify` 端到端退出 0。

| 门禁 | 结果 |
|------|------|
| `check`（types / lint / architecture / build / runtime-imports / manifest） | ✅ 架构边界 72 文件无反向依赖与循环 |
| `test:unit` + `test:critical-coverage` | ✅ 768 通过；全局 90/85/90/90，关键文件 95/85/91/95 |
| `test:component` | ✅ 231 通过 |
| `test:e2e` | ✅ 75 通过（离线受控，不依赖第三方网络） |
| `test:a11y` | ✅ 14 通过，深浅双主题 axe 零 critical/serious |
| `test:performance` | ✅ p95 bootstrap 41.3ms / domUpdate 32.9ms；节点 18 行 / 16 卡 |
| `npm audit --audit-level=high` | ✅ 0 漏洞 |
| `verify-deterministic-build` | ✅ 两次一致 `f9216373…`（102 条目） |
| `package:extension` + `check:bundle` | ✅ ZIP 140KB（<500KB 硬限） |
| `test:live`（实网，**不进 ci**） | ✅ 5.7s 拿到真实行情（改前同一断言 30s 拿不到） |

---

## 二、审查方法

不采信「测试全绿即无缺陷」。本次审查对每一条关键路径做了**独立实证**：

- 用 `curl` 与扩展 Service Worker 内的探针分别验证两个行情源的真实可达性；
- 用 Playwright 在真实扩展里驱动 RPC、注入失败、量化节点数与耗时；
- 对深色主题遍历 computed style，枚举所有浅色表面（而不是只看被举报的那一处）；
- 逐状态截图人工复核（列表 / 网格 / 对话框 / 列设置 / 操作菜单 × 深浅主题）；
- 对每个怀疑点先写**失败的**回归测试，再改代码。

---

## 三、发现并修复的产品缺陷

按严重度排列。每条都有对应的回归测试。

### P0 — 行情链路实际是单源，主源常被超时切断

- **备源永久失效**：`hq.sinajs.cn` 自 2022 起强制校验 `Referer`，而 `Referer`
  是 fetch 的 forbidden header，MV3 Service Worker 无法设置（注入需
  `declarativeNetRequest` 权限）。在扩展 SW 内实测**固定返回 403**——
  「双源降级」这条写进 AGENTS.md 的不变量从未成立。
- **主源预算不足**：`push2.eastmoney.com` 走 302 跳到 `push2delay`，冷连接实测
  TLS 握手 2.5–6.0s、总耗时 3.45–6.97s，而 provider 超时是 4s。首次刷新经常
  失败，失败又把退避推进到 30s，用户看到 `--` 且自动重试被压制。
- **为什么门禁没抓到**：全部单测 mock 传输层；唯一的实网用例断言
  `toContain('实时')`，而状态栏常驻渲染 `实时 ${count}`——该断言**恒真**，
  立刻通过后与网络赛跑。
- **修复**：备源换腾讯 `qt.gtimg.cn`（实测 0.5s、4/4 成功，沪深北三市正确解析）。
  同一断言改为 `/实时 [1-9]/` 后，从「30 秒拿不到非零实时计数」变为 4.5 秒通过。

### P1 — 失败的刷新播报「已更新」

`app-shell` 依据 `domain.quotes.counts.fresh` 判断成败，但 reducer 的
`quote/refresh/failed` 不重置 `domain.quotes`——残留的上一次成功快照让失败的
刷新播报成功。违反项目自身的「不伪成功」不变量。改为依据
`async.quoteRefresh.status`，并区分 stale 响应（交由后发起者播报）。

### P1 — 「列设置」是死按钮

工具栏发出 `column-panel-open-request`，而 `app-shell` 用一行注释显式忽略它。
`ColumnPanelElement` 已实现、已注册、有 236 行组件测试——用户点下去毫无反应。
现已接线：带版本校验的 `uiColumns:v1` 持久化 + popover 宿主 + 4 个真实扩展 E2E。

### P1 — 对账失败时写命令永久卡在 uncertain

写命令超时进入 uncertain 后会调 `app:bootstrap` 对账；这一步失败（SW 重建 /
再次超时）时错误直接从 `execute()` 抛出。所有调用点都是无 catch 的
`void controller.xxx()`，于是变成**未处理拒绝**，mutation 永远停在 uncertain。
改为落到 failed 终态；关键约束：拿不到权威快照时**绝不盲重试**写命令。

### P2 — single-flight 忽略请求的股票集合

旧实现只认「有没有在跑」，请求 `[X]` 的运行会把快照回给请求 `[X,Y]` 的调用方，
`Y` 从未被抓取却渲染成「缺失」。Popup 与后台 scheduler 各传自己的 watchlist
快照，刚加完股票时必然不一致。改为按 (排序后 code 集合 + force) 归并。

### P2 — provider 传输失败被空 catch 吞掉

这正是「备源永久 403」能瞒过全部单测与验收的原因。改为发射 `provider-failed`
诊断事件，带 provider 归因与失败原因。

### P2 — keyed 更新无条件重插节点

`updateKeyedChildren` 对每个节点无条件 `insertBefore`，而 DOM 规范下重新插入
已在树中的节点等于「先移除再插入」——**焦点丢失**、CSS 动画重启、每次刷新
N 次无谓结构变更。`stock-table` 里那段「保存 focusedKey → 渲染 → 手动 focus
回去」正是在绕这个坑，现已删除。

### P2 — bootstrap 存储读放大

冷启动 4 次存储操作，其中 `doReconcile` 重复 `loadUserData`（第二次 sanitize），
并用 `get(null)` 全库扫描把 500 条缓存的**值**全部反序列化——它只需要键名。
改为复用已加载数据 + `chrome.storage.local.getKeys()`（Chrome 130+，低版本回退）。

### P3 — 其他

- 三份 `BoardConfig` 默认值，其中 scheduler 那份已漂移成 `sortDirection: 'desc'`；
  收敛到 domain 唯一导出。
- 离线 E2E 的拦截列表漏掉新域名会让「离线」用例悄悄打真网；改为与
  `host_permissions` 对齐的单一列表。
- 虚拟滚动后聚焦「窗口里第一个节点」而非目标股票（我在本次虚拟化中引入，
  由新增测试抓出）。

---

## 四、性能

500 只自选股 / 20 分组：

| 指标 | 改造前 | 改造后 | 门槛 |
|------|--------|--------|------|
| domUpdate p95 | 77.4ms | **32.9ms** | ≤80ms（对外上限 100ms） |
| bootstrap p95 | 44.1ms | **41.3ms** | ≤200ms（原 250ms，已收紧） |
| 列表挂载节点 | 500 行 | **18 行** | ≤27 |
| 网格挂载节点 | 500 卡 | **16 卡** | ≤24 |

手段：纯函数虚拟窗口 + 帧合并调度、只挂载激活视图（此前隐藏视图也完整渲染，
DOM 工作量翻倍）、字段级 diff、消除无谓 DOM 移动。

性能门禁同时断言**节点上限**——只测耗时不够，机器够快时全量渲染也能压线通过。

---

## 五、视觉升级

原样式层是 967 行逐次叠加的 `components.css`：每个组件各自决定要不要上色，
谁忘了谁就掉回浏览器默认值（深色主题下添加表单白底黑字即由此而来）。

重建为 **tokens → base → 分域组件**（1694 行，7 文件）：

- `base.css` 用属性选择器接管表单默认值，新控件不需要「记得套 class」就已正确；
  加 `color-scheme` 让原生控件（滚动条 / select 下拉 / 复选框 / 自动填充）跟随主题。
- **界面 chrome 完全无彩色**：屏幕上只有红（涨）/ 绿（跌）/ 金（置顶）三种色相，
  全部承载数据语义；主按钮靠反相高对比表达主次。
- 数字等宽 + `tabular-nums`，名称中文无衬线——价格列逐位对齐，纵向扫描才成立。
- 签名元素：涨跌幅列的幅度条按 **A 股 ±10% 涨跌停**归一化，触及涨跌停时填满描边。

**信息架构才是真正的可读性问题**：上一版把七列平铺进 420px，每列不到 50px，
全部截断成「贵…」「+10…」。改为四列（股票 / 现价 / 涨跌幅 / 成交额）+ 操作列，
代码与行情状态降为股票列副标题，仍由列设置控制显隐。

---

## 六、安全面

| 项 | 结果 |
|----|------|
| `permissions` | `storage`, `alarms` —— 无 tabs / cookies / `<all_urls>` |
| `host_permissions` | 3 个域名，与源码中出站请求点**完全一致** |
| CSP | `script-src 'self'; object-src 'self'`，无远程代码 |
| `web_accessible_resources` / `externally_connectable` | 均未声明 |
| `innerHTML` | 仅静态 SVG 字面量，无用户数据插值，无注入面 |
| 出站数据 | 仅股票代码；自选股名称/分组名不外发 |
| 本地存储 | `uiTheme` / `uiColumns:v1` 仅展示偏好 |
| 依赖 | 0 漏洞 |

---

## 七、遗留与后续

- **迁移保留**：`migrateToV2`（v0/v1/v1.2.1 → v2）保留。它是老用户升级路径，
  不是回退方案——删掉等于现有用户升级后自选股全丢。
- **CI 门禁比本地 `ci` 薄**：`.github/workflows/ci.yml` 只跑 check / unit /
  e2e / performance / package / bundle，未跑 component 与 a11y。属既有状况，
  本次未扩大改动范围；建议后续补齐。
- **实网用例不进门禁**：`test:live` 依赖第三方端点可达性，境外 runner 上会随
  网络状况随机变红，改为按需运行。
- **薄适配器无单测**：`chrome-action-presenter` / `chrome-alarm-adapter` /
  `console-diagnostic-sink` 仅由 E2E 间接覆盖。

---

## 八、结论

**通过。** 13 个提交，覆盖 1 个 P0、3 个 P1、4 个 P2 与若干 P3 缺陷，
性能与视觉两条线均达成目标，安全面无扩大。

与旧验收报告最大的差别：这一版的「绿」经过了独立实证，而不是只依赖既有断言。
上一版恰恰是被一条恒真断言掩盖了产品最核心的功能失效。
