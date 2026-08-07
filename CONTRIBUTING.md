# 贡献指南

感谢你对「股票提醒助手」的兴趣！本文档帮助你快速参与开发。

> **开发规范的唯一权威是 [AGENTS.md](AGENTS.md)**（入口文件、架构分层、核心边界、不变量、风险路由、命令面、验证纪律）。本指南只补充贡献流程。

## 开发环境

```bash
node --version    # 需要 Node.js >= 22
npm install       # 安装开发依赖（.npmrc 已设 legacy-peer-deps）
npm run build     # TypeScript 编译 → build/extension/
```

`build/extension/` 是 Chrome 可加载的扩展目录（开发者模式 → 加载已解压的扩展程序）。

## 开发流程

### 1. 改动前

- 读 [AGENTS.md](AGENTS.md) 了解核心边界与风险路由（"改哪里、注意什么"）
- 读 [docs/项目架构.md](docs/项目架构.md) 了解整体架构
- 相关模块笔记见 `docs/module-*.md`

### 2. 改动中

- **TDD**：业务逻辑变更先写失败测试（见 AGENTS.md「验证纪律」）
- **最小改动 / YAGNI / DRY**
- **完整类型声明**（`strict: true`）
- **分层职责**：依赖只能由外向内，`npm run check:architecture` 会拒绝反向 import 和循环依赖

### 3. 改动后验证

```bash
npm run ci    # 类型 + lint + 架构边界 + 构建 + E2E + axe + 覆盖率门禁
```

纯 Domain / Protocol 改动优先跑：

```bash
npx tsx --test tests/unit/domain/ tests/unit/protocol/
```

### 4. 提交规范

使用 **Conventional Commits**（中文 type 可接受，见 `git log --oneline`）：

```
feat: 新增 XXX 功能
fix(popup): 修复 YYY 在 ZZZ 场景下的问题
docs: 更新架构文档
chore: 升级依赖
refactor(domain): 提取公共校验逻辑
```

### 5. 行为 / 接口 / 架构变更

须在提交前同步更新 [AGENTS.md](AGENTS.md) 及相关 `docs/`（见 AGENTS.md「验证纪律」）。

## 项目约定速查

- **不硬编码会变的数字**（测试计数、migration 数、门禁条数等），指向命令本身或代码常量
- 商店文案红线：本扩展**没有价格提醒功能**，备源是**腾讯**不是新浪，可配置列是 **5** 个，自定义分组上限 **19**（+1 默认）
- 新增测试文件必须落进某个会跑的 glob（`test:unit` 只匹配 `*.test.ts`，需打包产物的放 `tests/release/`）

## 测试体系

| 类型 | 命令 | 说明 |
|------|------|------|
| 单元 | `npm run test:unit` | tsx + node:test，覆盖率门禁 90/85/90/90 |
| 组件 | `npm run test:component` | happy-dom，生命周期 / DOM 映射 |
| E2E | `npm run test:e2e` | Playwright 真实扩展 |
| 无障碍 | `npm run test:a11y` | axe-core |

## 分支策略

- `main`：稳定主干
- feature 分支开发，合并前跑 `npm run ci`
