# v2.0.0 升级验收报告

- **日期：** 2026-08-04
- **分支：** `feature/v2.0.0-foundation-rebuild` @ `3cb7fd9`
- **结论：** ✅ **通过** —— 14 项发布检查清单 + 17 条 spec §16 验收要求全部满足；过程中发现并修复 1 处测试侧断言缺陷（非产品回归）。

---

## 一、Plan Final Verification Checklist（14 项）

| # | 检查项 | 结果 | 证据 |
|---|--------|------|------|
| 1 | `git status` 干净（发布打包前） | ⚠️ 有未提交改动 | 见「未提交改动」节：1 处测试修复 + 3 张 store 截图（capture 产物）。提交后即干净 |
| 2 | `npm ci` 从锁定 lockfile 退出 0 | ✅ | 196 包，0 漏洞，exit 0 |
| 3 | `npm run check` 退出 0 + 负向架构/import 夹具可证伪 | ✅ | tsc / lint / architecture / build / runtime-imports / manifest 全绿 |
| 4 | `test:contracts` 冻结 v1.3 契约 | ✅ | 2/2 通过 |
| 5 | `test:unit` + `test:critical-coverage` + `test:component` 覆盖门槛 | ✅ | 全局 90/85/90；关键文件 100% lines/statements，funcs≥91%、branches≥87%；unit 全过，critical 673/673，component 180/180 |
| 6 | `test:e2e` 覆盖 v1.3 行为 + 缺失流程（`build/extension`） | ✅ | 64/64 通过（SW 重启、缓存、双源失败、损坏缓存、冲突、uncertain 对账、键盘等） |
| 7 | `test:a11y` 零 axe critical/serious + 键盘/焦点/目标/对比/缩放 | ✅ | 13/13 通过 |
| 8 | `test:performance` p95 预算 + 8s 行情 deadline | ✅ | bootstrap p95 94.7ms≤250；interactive≤500；domUpdate 7.8ms≤100；8s deadline 通过 |
| 9 | `verify-rollback` v1.3→v2→v1.3 回读→v2 再升级 | ✅ | v1.3 ZIP SHA `aed997fb…` 校验通过；v0/v1/v2 迁移 round-trip；回读+再升级；CONFLICT 保护 OK |
| 10 | `verify-deterministic-build` 两次 ZIP 哈希一致 | ✅ | 两次均 `048a55dd…`（94 条目） |
| 11 | `npm audit --audit-level=high` 退出 0 | ✅ | 0 漏洞 |
| 12 | `package:extension` + `check:bundle` 仅 v2 zip 且 ≤500KB | ✅ | `dist/stock-alert-extension-v2.0.0.zip` 110KB（<200KB 提醒 / <500KB 硬限）；`v1.3.0.zip` 为回滚保留件 |
| 13 | `rg` 无 v1 全局/经典脚本/CJS 运行时导出/bare import/路径别名/反向层 import/假行情/v1 适配 | ✅ | 全部 none；唯一 legacy 命中为 `watchlist_legacy`（v0→v2 迁移字段，spec §7.3 允许） |
| 14 | 干净 profile 安装 + 用户流 smoke + 回滚演练 + ZIP SHA + 发布证据 入 `RELEASE-v2.0.0.md` | ✅ | `RELEASE-v2.0.0.md` 含日期/标签/SHA/capture 证据/回滚步骤/v1.3 SHA；`capture:store` 截图已生成 |

---

## 二、Spec §16 验收要求（17 条）

| # | 要求 | 结果 | 证据 |
|---|------|------|------|
| 1 | 运行时 JS 全 TS，输出原生 ESM | ✅ | check:types(ESM) + check:runtime-imports OK |
| 2 | Runtime 零三方依赖、无框架/打包器 | ✅ | rg 无 bare import；package 仅 devDeps |
| 3 | 无 State/Render/Actions 全局单例或依赖加载顺序的模块 | ✅ | architecture 拒绝反向/循环；build 仅 ESM；无 classic script |
| 4 | 架构检查无循环依赖/反向跨层 import | ✅ | check:architecture OK（70 files） |
| 5 | Popup 组件仅接收 VM、发语义事件，不访问 Bridge/Repository | ✅ | component 测试 + 架构层约束；AppShell 为组合根 |
| 6 | Reducer 是 AppState 唯一写入口 | ✅ | reducer.ts 100% 覆盖；组件仅发事件 |
| 7 | Popup 远端行情/搜索全经 SW | ✅ | 架构层：搜索/行情只发生在 SW |
| 8 | RPC v2 类型/校验/requestId/超时/结构化错误完整 | ✅ | protocol registry + validators 100%；e2e 覆盖 exactly-once / uncertain 对账 |
| 9 | schema v2 / 迁移备份 / g_all / revision / 唯一 Coordinator 串行临界区 / 缓存不变量 | ✅ | verify-rollback + storage 单测（100% lines） |
| 10 | v1.0–v1.3 数据快照无损加载；v2 数据可被 v1.3.0 回读 | ✅ | verify-rollback + contracts v1.3 readback |
| 11 | SW 重启不丢数据/伪成功/错误行情态 | ✅ | e2e「popup remains usable after SW restart」+ backoff 持久化 session |
| 12 | 所有鼠标操作有键盘等价；Dialog/异步重渲染焦点正确 | ✅ | a11y 键盘/Tab/Escape/焦点恢复 13 项全过 |
| 13 | axe 无 critical/serious；对比度/触控目标达标 | ✅ | a11y 7 状态 axe 零 critical/serious + 对比/44px/zoom |
| 14 | 静态检查/覆盖率/单元/组件/E2E 全过 | ✅ | `npm run ci` 全绿 |
| 15 | 不新增权限/远端代码/模拟行情 | ✅ | manifest 校验；rg 无假行情；permissions 未变 |
| 16 | 构建产物确定/完整/体积内；远端 CI + Release 全绿 | ✅ | deterministic build + check:bundle + release 各子项全绿 |
| 17 | v2 无 v1 运行时兼容代码；冻结 v1.3.0 回滚/再升级验收 | ✅ | rg 无 v1 适配；verify-rollback 全流程通过 |

---

## 三、修复的缺陷（1 处，测试侧，非产品回归）

- **文件：** `tests/e2e/failure-injection.spec.ts` —「popup remains usable after SW restart」
- **问题：** 断言期望名称 `贵州茅台`，但 seed 用 `stock('sh600519')`（fixture 中 `name='股票0'`），且 `offline:true` 无行情缓存 → 名称不可得。产品行为正确（渲染出 `股票0 / sh600519 / 缺失` 且 SW 重启后 popup 仍可用），属测试断言与 seed 不一致（疑似从 `portfolio.spec` 复制断言未同步 seed）。
- **修复：** 断言改为 `股票0`。修复后该用例通过，全量 E2E 64/64 绿。

---

## 四、未提交改动（打包前需处理）

- `M tests/e2e/failure-injection.spec.ts` — 上述测试修复（建议提交）
- `M store-assets/screenshot1-list.png` / `screenshot2-grid.png` / `screenshot3-add.png` — `capture:store` 生成的商店素材（发布流程产物，可一并提交）
- 提交后 `git status` 即干净，满足清单第 1 项。

---

## 五、结论

v2.0.0 升级验收 **通过**。所有 14 项发布检查清单与 17 条 spec 验收要求均满足或已通过修复达成。唯一遗留为上述未提交改动，提交后即可进入发布打包（`npm run release:verify` 各子门禁在本会话已逐一实测全绿）。**无产品级回归。**
