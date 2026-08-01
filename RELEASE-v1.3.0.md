# v1.3.0 — 架构与体验

**发布日期：** 2026-08-01
**标签：** `v1.3.0`
**下载：** `dist/stock-alert-extension-v1.3.0.zip`

**SHA-256：** `913dd82f56b680d2b55725d91c42c38b773ae258a8436543a5fd09b45d49c0bc`

---

## 本次更新亮点

### ⚙️ 架构升级（用户无感但更可靠）

- **Service Worker 成为行情数据唯一所有者**：弹窗与后台之间通过 RPC 消息总线通信（14 个 action），行情读取与存储不再有双写路径，数据一致性更强
- **popup.js 模块化**：原 1355 行单体拆分为 `bridge / state / render / actions` 四个职责清晰的模块，后续维护和迭代更快

### ♿ 无障碍（WCAG 2.1 AA）

- **键盘导航**：分组标签支持 ← → 方向键切换，股票卡片支持 Enter / 空格置顶
- **ARIA 标记**：分组栏、看板、弹窗、提示消息均标注无障碍角色，屏幕阅读器可完整朗读
- **颜色对比度**：次要文本与涨跌色加深至 4.5:1，深色背景下文字清晰可读
- **触控目标**：工具栏按钮扩展至 44px 最小点击区域
- **动效偏好**：支持 `prefers-reduced-motion`，系统开启减少动态时自动关闭动画

### 🛠 代码质量

- 提取 `quote-format.js` 共享格式化模块，消除弹窗与后台的重复代码
- CSS 设计令牌系统（Custom Properties），主题色统一管理
- 协议契约测试：弹窗 ↔ 后台 14 个 RPC action 一致性自动验证

---

## 安装方式

### 开发者模式

1. 下载 `stock-alert-extension-v1.3.0.zip` 并解压
2. 打开 `chrome://extensions`，启用「开发者模式」
3. 点击「加载已解压的扩展程序」，选择解压目录

### 校验

```bash
shasum -a 256 stock-alert-extension-v1.3.0.zip
# 期望输出：
# 913dd82f56b680d2b55725d91c42c38b773ae258a8436543a5fd09b45d49c0bc
```

---

## 测试与质量门禁

- **133 个单元测试**，覆盖率门禁 90/85/90/90（实际 99.2 / 88.3 / 94.9 / 99.2）
- **13 个 Playwright E2E 测试**：真实 Chrome 扩展环境，覆盖键盘导航、ARIA 结构、行情三态、缓存降级
- **确定性打包**：固定 mtime + SHA-256，同一源码每次构建产物一致

---

## 完整更新日志

详见 [CHANGELOG.md](CHANGELOG.md) 或 [GitHub Releases](https://github.com/orxz/stock-alert-extension/releases)。

## 商店素材

- 商店描述：`store-assets/store-description-v1.3.0.txt`
- 商店截图：`store-assets/screenshot1-list.png` / `screenshot2-grid.png` / `screenshot3-add.png`
