# 安全策略

## 报告安全漏洞

如果你发现安全漏洞，**请不要在公开 issue 中报告**。

请通过以下方式私密报告：

1. 在 GitHub 上使用 **Security Advisories**（Repo → Security → Report a vulnerability）
2. 或发邮件至仓库 owner（见 GitHub profile）

## 响应时效

- **确认收到**：48 小时内
- **初步评估**：5 个工作日内
- **修复发布**：视严重程度，critical 尽快、high 两周内

请在修复发布前**不要公开披露**漏洞详情。修复后我们会在发布说明中致谢（除非你要求匿名）。

## 支持版本

仅最新发布版本接受安全修复。

## 安全设计概要

- **权限最小化**：仅 `storage` + `alarms`，无 `host` 外权限
- **CSP**：`script-src 'self'; object-src 'self'`，无远程代码
- **零运行时第三方依赖**
- **数据隐私**：自选股数据仅存本地，行情请求仅发送股票代码，无遥测
- 详见 [隐私政策](extension/privacy/index.html)
