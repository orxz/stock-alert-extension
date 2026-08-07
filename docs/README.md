# 文档中心

> 本索引是 `docs/` 的导航入口。**开发规范唯一权威是根目录 [AGENTS.md](../AGENTS.md)**（Qoder / 通用 Agent 入口），Claude Code 入口见 [CLAUDE.md](../CLAUDE.md)；整体架构概览见 [项目架构.md](项目架构.md)。

## 文档体系总览

```text
stock-alert-extension/
├── README.md            — 项目说明 / 安装 / 使用（面向用户与商店）
├── AGENTS.md            — 开发规范唯一权威（入口/边界/不变量/风险路由/命令面/验证纪律）
├── CLAUDE.md            — Claude Code 适配入口（指向 AGENTS.md，不重复规范）
├── CONTRIBUTING.md      — 贡献指南（环境/流程/提交规范/测试）
├── SECURITY.md          — 安全漏洞报告策略
├── CHANGELOG.md         — 更新日志（所有版本变更的唯一流水）
├── LICENSE              — MIT
└── docs/
    ├── README.md          — 本索引
    ├── 项目架构.md         — 整体架构概览（分层图 / 数据流 / 技术栈）
    ├── module-*.md        — 模块笔记（background / popup / quotes / storage）
    ├── branch-protection.md / multi-browser-publishing.md — 流程
    ├── 自选股分组…产品规格文档.md / 股票提醒助手_功能说明书….md — 产品规格
    ├── design-v1.1.0-multi-market.md — 历史设计快照（v1.1.0）
    ├── 朋友安装指南.md     — 非技术用户安装图文
    ├── release/           — 发布说明快照（RELEASE-vX.Y.Z.md）
    └── superpowers/       — superpowers 工具产物（plans / specs / ACCEPTANCE）
```

## 索引

### Agent 入口与规范

| 文件 | 定位 | 读者 |
|------|------|------|
| [../AGENTS.md](../AGENTS.md) | 开发规范唯一权威 | 所有 Agent / 开发者 |
| [../CLAUDE.md](../CLAUDE.md) | Claude Code 适配入口 | Claude Code |
| [项目架构.md](项目架构.md) | 整体架构概览（分层图 / 数据流 / 技术栈 / 代码前缀规范） | 所有读者 |

### 模块笔记（架构落地细节）

| 文件 | 模块 |
|------|------|
| [module-background.md](module-background.md) | Service Worker（listener / 初始化屏障 / Router / Scheduler / Badge） |
| [module-popup.md](module-popup.md) | Popup（不可变 Store / Reducer / Components / Commands） |
| [module-quotes.md](module-quotes.md) | 行情（Provider 传输层 / QuoteService 编排 / 缓存与退避） |
| [module-storage.md](module-storage.md) | 存储（StorageCoordinator 单队列 / schema v2 / 迁移） |

### 产品规格

| 文件 | 定位 |
|------|------|
| [自选股分组与看板管理-产品规格文档.md](自选股分组与看板管理-产品规格文档.md) | 分组 / 看板 / 列设置的产品规格 |
| [股票提醒助手_功能说明书与API集成指南.md](股票提醒助手_功能说明书与API集成指南.md) | 功能清单与行情 / 搜索 API 集成 |

### 流程与发布

| 文件 | 定位 |
|------|------|
| [branch-protection.md](branch-protection.md) | 分支保护策略 |
| [multi-browser-publishing.md](multi-browser-publishing.md) | Edge / Chromium 系跨浏览器上架流程 |
| [release/](release/) | 发布说明快照（`RELEASE-vX.Y.Z.md`），完整流水见根目录 CHANGELOG.md |
| [design-v1.1.0-multi-market.md](design-v1.1.0-multi-market.md) | 历史设计快照（v1.1.0 多市场支持，归档参考） |

### 用户向

| 文件 | 定位 |
|------|------|
| [朋友安装指南.md](朋友安装指南.md) | 非技术用户的图文安装指引 |

### 工具产物（非项目自有，按需查阅）

| 目录 | 来源 |
|------|------|
| [superpowers/](superpowers/) | superpowers 工具的计划 / 规格 / 验收报告，随版本沉淀，不作为权威规范源 |

## 命名约定

| 类别 | 约定 | 示例 |
|------|------|------|
| 根目录标准文件 | 固定大写名 | `AGENTS.md` / `CLAUDE.md` / `README.md` / `CHANGELOG.md` / `LICENSE` |
| `docs/` 新增文档 | 英文小写连字符（kebab-case） | `module-background.md`、`branch-protection.md` |
| 版本化快照 | `大写-vX.Y.Z.md`，归档到 `docs/release/` | `release/RELEASE-v2.0.1.md` |

> 已有中文命名的文档（`项目架构.md`、`朋友安装指南.md` 等）保持原名以避免破坏既有引用；新增文档统一用英文 kebab-case。

## 维护纪律

- **行为 / 接口 / 架构变更**须在提交前同步更新 [../AGENTS.md](../AGENTS.md) 及相关 `docs/`（见 AGENTS.md「验证纪律」）。
- **文档不硬编码会变的数字**（测试计数、migration 数、门禁条数等），指向命令本身或代码常量。
- 商店文案红线见 AGENTS.md「风险路由 → 改商店素材 / 文案」。
