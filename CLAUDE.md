# CLAUDE.md — 股票提醒助手（Claude Code 入口）

> 本项目同时服务多个 Agent。**开发规范的唯一权威是 [AGENTS.md](AGENTS.md)**——入口文件、架构分层、核心边界、不变量、风险路由、命令面、验证纪律全部在那里。本文件是 Claude Code 的适配入口，**不重复规范内容**，只补充 Claude Code 环境下的约定与导航。

## 在 Claude Code 中开发本项目

### 先读

1. [AGENTS.md](AGENTS.md) — 开发规范全集。**所有代码改动必须符合 AGENTS.md。**
2. [docs/项目架构.md](docs/项目架构.md) — 整体架构概览（分层图 / 数据流 / 技术栈），人类视角的快速理解入口。

### 工具映射

AGENTS.md 的命令面均基于 `npm run *`，在 Claude Code 中直接用 Bash 工具执行：

| 场景 | 命令 |
|------|------|
| 改动后验证 | `npm run ci`（类型 + lint + 架构边界 + 构建 + E2E + axe + 覆盖率门禁） |
| 纯 Domain / Protocol 改动 | 优先 `tests/unit/domain/` / `tests/unit/protocol/` |
| 发布前 | `npm run release:verify` |
| 商店素材重生成 | `npm run capture:store`（让 `test:build` 校验规格） |

### 约定（与 AGENTS.md 一致，此处仅列要点）

- **不硬编码会变的数字**（测试计数、migration 数、门禁条数等），指向命令本身或代码常量。
- **Git 用 Conventional Commits**（提交风格见 `git log --oneline`，以中文 type 开头）。
- **行为 / 接口 / 架构变更须在提交前同步更新 [AGENTS.md](AGENTS.md)** 及相关 `docs/`。
- 文案只许描述源码中真实存在的能力（详见 AGENTS.md「风险路由 → 改商店素材 / 文案」）。
- 商店文案红线：本扩展**没有价格提醒功能**（「股票提醒助手」只是产品名），备源是**腾讯**不是新浪，可配置列是 **5** 个，自定义分组上限 **19**（+1 个默认）。
