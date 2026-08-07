## 变更摘要

<!-- 用 1-3 句话描述本 PR 做了什么、为什么 -->

## 关联 Issue

<!-- 关闭 #issue_number 或链接到相关讨论 -->

## 变更类型

- [ ] feat — 新功能
- [ ] fix — 缺陷修复
- [ ] refactor — 重构（无行为变化）
- [ ] perf — 性能优化
- [ ] docs — 文档
- [ ] chore — 构建 / 依赖 / 杂项
- [ ] test — 测试补充或修复

## 自检清单

- [ ] 已读 [AGENTS.md](AGENTS.md) 并确认改动符合核心边界与不变量
- [ ] 代码经 `npm run ci` 全绿（类型 + lint + 架构边界 + 构建 + 测试 + 覆盖率门禁）
- [ ] 纯 Domain / Protocol 改动已优先跑对应单元测试
- [ ] 行为 / 接口 / 架构变更已同步更新 [AGENTS.md](AGENTS.md) 及相关 `docs/`
- [ ] 不硬编码会变的数字（指向命令或代码常量）
- [ ] 提交使用 Conventional Commits

## 测试计划

<!-- 描述如何验证本变更，例如： -->
<!-- - 新增了 `tests/unit/domain/xxx.test.ts`，覆盖边界情况 Y -->
<!-- - 手动验证：加载 build/extension/，执行操作 Z，确认结果 -->
