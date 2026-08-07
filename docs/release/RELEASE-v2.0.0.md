# v2.0.0 — 基础架构重建

**发布日期：** 2026-08-04
**标签：** `v2.0.0`
**下载：** `dist/stock-alert-extension-v2.0.0.zip`

**SHA-256：** `048a55ddbfb732cb484b2d2d19aad9557e898dbd861fe969e881e1430755e520`

> 注：SHA 随 a11y 修复（`2b0edf3`）、fetch 绑定修复与布局（hidden 覆盖）修复后的重打包更新（94 条目）。

---

## 本次更新亮点

> **基础架构重建，不新增提醒功能。** 用户数据（schema v2）与权限保持不变，v1.3.0 发布包可安全回滚。

### 🏗️ 架构重建（用户无感但更坚固）

- **TypeScript + 原生 ES Modules**：所有运行时源码改为 TypeScript，`tsc` 输出原生 ESM；零运行时第三方依赖，无框架、无打包器
- **分层架构**：Domain / Protocol / Application / Infrastructure / Background / Popup 六层，依赖只能由外向内；架构检查脚本自动拒绝反向 import 和循环依赖
- **单一 StorageCoordinator**：`chrome.storage.local` 的唯一写入队列，用户数据与行情缓存的读写进入同一串行临界区，消除并发竞态
- **内容 revision 乐观并发**：所有写命令携带 `expectedRevision`（SHA-256 摘要），冲突时返回 `CONFLICT` 且不执行写入
- **版本化 RPC v2**：单一注册表统一 13 个方法 / payload / result / 运行时校验；`requestId` 贯穿全链路；结构化错误码 + `retryable`

### 🔄 可信数据流

- **不可变 Popup Store**：纯 Reducer 是唯一状态写入口；超时写入进入 uncertain 状态，经 bootstrap 对账确认后再更新——绝不盲目回滚或显示伪成功
- **可重试初始化屏障**：Service Worker 可在任意事件后被销毁并无损重建；退避状态持久化到 `chrome.storage.session`
- **安全 Alarm 调度**：每次任务先创建最迟安全 Alarm，结束后替换为精确 Alarm；每次激活都校验 Alarm 存在

### ♿ 无障碍与质量门禁

- **axe-core 零 critical/serious**；44×44px 触控目标；WCAG 2.1 AA 对比度；完整键盘操作等价
- **覆盖率**：全局 90/85/90/90；Domain/Protocol/Storage/Reducer 95/90/95/95
- **性能预算**：20 分组 / 500 股票 bootstrap p95 ≤ 250ms；首次可交互 p95 ≤ 500ms
- **确定性构建**：两次清洁构建产生字节一致 ZIP；ZIP ≤ 500 KB 且不含源码 / 测试 / map

### 🔙 回滚保证

- v2.0.0 写出的 schema v2 数据可被冻结的 v1.3.0 发布包安全读取
- v2.0.0 不持久化只有新版本才能解释的必需字段
- 保留 v1.3.0 ZIP（SHA `aed997fb…`）、标签和测试专用 reference-reader
- `verify-rollback.mjs` 自动验证 v1.3 → v2 写入 → v1.3 回读 → v2 再升级兼容性

---

## 数据与权限保证

| 项目 | 保证 |
|------|------|
| schema | v2 不变（`groups` / `watchlist` / `boardConfig` / `quoteCache:<code>`） |
| permissions | `storage` + `alarms` 不变 |
| host_permissions | `hq.sinajs.cn` / `push2.eastmoney.com` / `searchapi.eastmoney.com` 不变 |
| 行情语义 | `price > 0`、东财主源 + 新浪备源、50 只/批、4s/8s 超时、fresh `<30s`、cached `30s–7d`、退避 `30s→2m→5m` 不变 |
| 模拟价格 | 绝不生成 |

---

## 安装方式

### 开发者模式

1. 下载 `stock-alert-extension-v2.0.0.zip` 并解压
2. 打开 `chrome://extensions`，启用「开发者模式」
3. 点击「加载已解压的扩展程序」，选择解压目录

### 校验

```bash
shasum -a 256 stock-alert-extension-v2.0.0.zip
# 期望输出：（见上方 SHA-256）
```

---

## Chrome Web Store 回滚与再升级演练

严重故障时使用商店回滚能力发布旧运行时（v1.3.0），不恢复或转换用户数据：

1. **回滚**：在 Chrome Web Store 开发者控制台将活跃发布回退到 v1.3.0
2. **验证**：v1.3.0 运行时读取 v2.0.0 写出的 schema v2 数据（由 `verify-rollback.mjs` 自动覆盖）
3. **再升级**：修复后重新发布 v2.0.0+，数据无需迁移

分批发布不能作为唯一保护措施，因为商店百分比发布可能受活跃用户规模限制。

---

## 测试与质量门禁

- **静态**：TypeScript strict + ESLint + 架构边界 + runtime import + manifest 校验
- **单元**：Domain / Protocol / Storage / Application / Background / Popup Store
- **组件**：happy-dom 生命周期、DOM 映射、语义事件、焦点、keyed update
- **E2E**：真实 `build/extension/` 加载，覆盖完整 CRUD / 排序 / 批量 / 并发 / 恢复 / 键盘
- **无障碍**：axe-core 扫描空状态 / 网格 / 列表 / Dialog / 错误状态
- **性能**：20 分组 / 500 股票 p95 预算
- **回滚**：`verify-rollback.mjs` + `verify-deterministic-build.mjs`
- **0 个依赖漏洞**（`npm audit --audit-level=high` 通过）

---

## 完整更新日志

详见 [CHANGELOG.md](../../CHANGELOG.md)。

## 商店素材

- 商店描述：`../../store-assets/store-description-v2.0.0.txt`
- 商店截图：`../../store-assets/screenshot1-list.png` / `../../store-assets/screenshot2-grid.png` / `../../store-assets/screenshot3-add.png`
