# 多浏览器上架流程

本文档记录「股票提醒助手」在 Chromium 系浏览器（Chrome / Edge / Brave / Opera / Vivaldi）上的发布路径。

## 兼容性结论

本扩展是 Manifest V3 扩展，运行时 API 依赖如下：

| 依赖项 | Edge | Brave | Opera | Vivaldi |
|---|---|---|---|---|
| MV3 manifest (`manifest_version: 3`) | ✅ | ✅ | ✅ | ✅ |
| `background.service_worker` (type: module) | ✅ | ✅ | ✅ | ✅ |
| `chrome.runtime` (sendMessage / onMessage / lastError / onInstalled / onStartup) | ✅ | ✅ | ✅ | ✅ |
| `chrome.storage.local` + `session` + `onChanged` | ✅ | ✅ | ✅ | ✅ |
| `chrome.alarms` (get / create / onAlarm) | ✅ | ✅ | ✅ | ✅ |
| `chrome.action` (setBadge\* / setTitle) | ✅ | ✅ | ✅ | ✅ |
| 权限 `storage` + `alarms` | ✅ | ✅ | ✅ | ✅ |
| host_permissions（东财 ×2 + 腾讯 ×1） | ✅ | ✅ | ✅ | ✅ |
| CSP `script-src 'self'; object-src 'self'` | ✅ | ✅ | ✅ | ✅ |

**零代码改动**——所有 Chromium 系浏览器共用同一份构建产物（`build/extension/`）和同一份发布包（`dist/stock-alert-extension-v<ver>.zip`）。manifest 不含任何浏览器专有字段。

跨浏览器回归由 CI 中的 Edge channel 冒烟守护（见下文「发布后回归」）。

## 1. Chrome Web Store（主渠道）

Chrome Web Store 是主发布渠道。发布到这里的同一个包**天然覆盖**：

- **Chrome**（原生）
- **Brave**（基于 Chromium，自动同步 Web Store 扩展）
- **Vivaldi**（基于 Chromium，自动同步 Web Store 扩展）
- **Opera**（用户安装「Install Chrome Extensions」后可从 Web Store 安装）

### 前置检查

每次发布前确认：

1. `extension/manifest.json` 的 `version` 已更新（格式 `x.y.z`）
2. `npm run check` 全绿（含 `validate:manifest` 校验 MV3 字段、权限、host、CSP、入口文件存在性）
3. `npm run test:build` 通过——校验 `store-assets/` 截图规格（1280×800 或 640×400、小图块 440×280、顶部图块 1400×560、24 位无 alpha PNG）
4. `store-assets/store-description-v<ver>.txt` 文案只描述**源码中真实存在**的能力

### 提交流程

1. 访问 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
2. 一次性支付 5 美元注册费（新开发者）
3. 上传 `dist/stock-alert-extension-v<ver>.zip`（由 `npm run package:extension` 生成，固定时间戳保证可复现）
4. 填写商店信息：
   - 描述：使用 `store-assets/store-description-v<ver>.txt`
   - 截图：使用 `store-assets/screenshot1-grid.png` 等（1280×800）
   - 小图块：`store-assets/promo-small.png`（440×280）
   - 顶部图块：`store-assets/promo-large.png`（1400×560）
   - 图标：`store-assets/store-icon-128.png`
5. 隐私声明 URL：指向扩展内置的 `extension/privacy/index.html`（需托管到公网可访问的 URL）
6. 权限说明：`storage`（本地存储自选股数据）、`alarms`（定时刷新行情）
7. 提交审核（通常 1-3 个工作日）

## 2. Microsoft Edge Add-ons

Edge Add-ons 独立于 Chrome Web Store，需要单独提交。Edge 基于 Chromium，同一份 ZIP 包可直接使用。

### 前置检查

与 Chrome Web Store 相同（同一份构建产物）。

### 提交流程

1. 访问 [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview)
2. 使用 Microsoft 账号登录，完成开发者注册
3. 点击「Create new extension」→ 上传 `dist/stock-alert-extension-v<ver>.zip`
4. 填写商店信息（与 Chrome Web Store 一致）：
   - 描述、截图、隐私声明 URL
   - 权限说明：`storage` + `alarms` + 三个 host_permissions
5. 提交审核（通常数小时到数天）

### 可选：Partner Center API 自动化上传

Microsoft 提供 [Edge Add-ons API](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/api/using-addons-api) 用于自动化上传。需在 Partner Center 创建 API 凭证（client ID + client secret + product ID），然后调用上传端点。此为可选增强，不在当前代码范围。

## 3. Opera Add-ons（可选）

Opera 有独立扩展商店。由于 Opera 用户可通过「Install Chrome Extensions」从 Chrome Web Store 侧载，**独立上架到 Opera Add-ons 为可选项**，非必须。

### 提交流程（如需独立上架）

1. 访问 [Opera Add-ons Developer Portal](https://addons.opera.com/developer/)
2. 注册开发者账号
3. 「Submit a new extension」→ 上传 `dist/stock-alert-extension-v<ver>.zip`
4. 填写商店信息（与上述一致）
5. 提交审核

## 4. 发布后回归

### CI Edge 冒烟（自动化）

CI workflow（`.github/workflows/ci.yml`）已配置：

- `npx playwright install --with-deps msedge`——安装 Edge 浏览器
- `xvfb-run -a npm run test:cross-browser`——在 Edge channel 上跑跨浏览器冒烟（`tests/e2e/cross-browser.spec.ts`）

冒烟覆盖核心闭环（fresh profile bootstrap → seed 股票渲染 → 切分组 view 不变量 → 增删股票写回），使用 offline 模式不依赖实网行情。

本地手动验证（需安装 Edge）：

```bash
npx playwright install msedge
npm run build
E2E_CHANNEL=msedge npx playwright test --project=edge
```

### 各浏览器手动冒烟（发布前）

在目标浏览器中加载 `build/extension/`（开发者模式 → 加载已解压扩展），验证：

1. 打开弹窗 → 正常渲染（无 SW/popup 异常）
2. 添加股票 → 渲染正确
3. 删除股票 → 回到空状态
4. 切分组 → 选中集 ⊆ 当前分组可见集
5. 等情刷新 → 退避/缓存正常

## 不在范围

- **Firefox**：需 `browser_specific_settings`、AMO 审核、`browser.*` 命名空间适配，本次评估不含。
- **Safari**：需 Xcode 打包签名、App Store 上架、Safari Web Extension 适配，成本最高，本次不含。
- 实际上架动作需账号凭证，由开发者按本文档完成。
