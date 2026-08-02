# 分支保护规则 — 配置指南

> 本文档记录推荐的 GitHub main 分支保护规则。
> 需要在 GitHub 仓库 **Settings → Branches → Add rule** 中手动配置。

## 推荐规则

### Branch name pattern
```
main
```

### 规则设置

| 规则 | 状态 | 说明 |
|------|------|------|
| Require a pull request before merging | ✅ 开启 | 所有变更必须通过 PR 合并 |
| Require approvals | ✅ 设置为 1 | 至少 1 人审批（个人项目可关闭） |
| Require status checks to pass | ✅ 开启 | CI 全绿才能合并 |
| Require branches to be up to date | ✅ 开启 | 合并前必须 rebase 最新 |
| Require conversation resolution | ✅ 开启 | 所有 review 评论必须标记为已解决 |
| Do not allow bypassing the above settings | ✅ 开启 | 管理员也不能绕过规则 |

### 必须通过的状态检查

以下检查必须全部通过才能合并：

```
test (pull_request)  — npm run check + test:unit + test:e2e + package + check:bundle（ci.yml 的 job 名）
```

## 配置命令（GitHub CLI）

如果已安装 `gh` CLI，可通过命令设置：

```bash
# 设置分支保护（需要管理员权限）
gh api repos/{owner}/{repo}/branches/main/protection \
  -X PUT \
  -f required_status_checks='{"strict":true,"contexts":["test (pull_request)"]}' \
  -f enforce_admins=true \
  -f required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true}' \
  -f restrictions='null'
```

## 例外情况

- **紧急修复**：可在 PR 标题中标注 `[hotfix]`，通过管理员权限临时绕过（建议事后补审）
- **文档更新**：纯文档变更（`*.md`）可考虑配置为不需要审批
