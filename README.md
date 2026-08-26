# 股票提醒助手 — 自选股分组与看板

[![CI](https://github.com/orxz/stock-alert-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/orxz/stock-alert-extension/actions/workflows/ci.yml)
[![Release](https://github.com/orxz/stock-alert-extension/actions/workflows/release.yml/badge.svg)](https://github.com/orxz/stock-alert-extension/actions/workflows/release.yml)
[![CodeQL](https://github.com/orxz/stock-alert-extension/actions/workflows/codeql.yml/badge.svg)](https://github.com/orxz/stock-alert-extension/actions/workflows/codeql.yml)
[![Version](https://img.shields.io/badge/version-v2.6.0-blue)](https://github.com/orxz/stock-alert-extension/releases/tag/v2.6.0)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-orange)](extension/manifest.json)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A 股自选股看板 Chrome 扩展：大盘指数条、分组管理、实时行情、分时/K线图表。覆盖**沪深主板、科创板、创业板、北交所**及主要大盘指数，数据只存本地，行情状态如实标注（实时 / 缓存 / 缺失），绝不生成模拟价格。

| 网格视图 | 列表视图 | 添加股票 |
|:---:|:---:|:---:|
| ![网格](docs/screenshots/screenshot2-grid.png) | ![列表](docs/screenshots/screenshot1-list.png) | ![添加](docs/screenshots/screenshot3-add.png) |

## 核心功能

- **大盘指数条** — 上证指数 / 深证成指 / 创业板指 / 科创50 常驻顶部（2×2 网格），每只带迷你走势图；点击任意指数即看完整分时与K线；搜索还能把指数加进自选
- **分时与K线** — 点击股票/指数打开详情面板：分时图（价格线 + 均价 + 昨收基准 + 量能副图）、日K/周K/月K（蜡烛 + MA5/10/20 + 量能副图）、十字光标悬浮读数；hover 浮层另带迷你分时
- **涨跌停** — 腾讯真值优先，缺失时按交易所规则推导（主板 ±10%、ST ±5%、创业/科创 ±20%、北交 ±30%），涨跌幅幅度条按板块归一
- **多分组看板** — 最多 19 个自定义分组（+「全部」默认视图），拖拽排序；股票加入任意分组后始终可见
- **可信行情** — 东方财富主源 + 腾讯备源，失败保留 7 天本地缓存；实时 / 缓存（旧 HH:MM）/ 缺失（`--`）三态明确
- **双视图 + 排序** — 网格卡片 / 数据列表，按涨跌幅、价格、成交额、自选时间排序，置顶与手动拖拽互不干扰
- **排序联动角标** — 工具栏图标实时显示排序第一只股票的涨跌幅（红涨绿跌，缓存灰显），悬停查看前 5 只
- **智能搜索** — 代码 / 拼音 / 中文名称联想补全（含指数），API 失败时自动降级本地搜索
- **实用细节** — 自定义 5 列、价格隐藏（投屏友好）、盘中 10 秒 / 盘外 5 分钟自适应刷新、虚拟滚动

## 安装

### Chrome 商店（推荐）

<a href="https://chromewebstore.google.com/detail/fmaalgiagnaeihdeninmdmohleangggh" target="_blank">
  <img src="https://img.shields.io/badge/Chrome%20Web%20Store-v2.6.0-blue?logo=google-chrome" alt="Chrome Web Store">
</a>

### 开发者模式

1. 下载发行包 `stock-alert-extension-v2.6.0.zip` 并解压
2. 打开 `chrome://extensions`，启用「开发者模式」
3. 点击「加载已解压的扩展程序」，选择解压目录

> 完整图文步骤见 [朋友安装指南](docs/朋友安装指南.md)。

## 使用说明

### 三分钟上手

1. **添加股票** — 点击 `＋`，输入代码（`600519`）、拼音（`mt`）或名称（`茅台`），联想补全后确认；市场前缀自动识别（600→沪、300→创业板、920→北交所等）；指数同理（搜「上证指数」或 `sh000001`）
2. **组织分组** — 底部分组栏 `＋` 新建分组（如「持仓」「观察」）；选中股票 → 批量模式 → 移动到分组
3. **看行情** — 顶部指数条看大盘方向；点击股票/指数卡片看分时与K线；悬停行/卡片看 16 项详情 + 迷你走势；工具栏切换排序方式，角标自动跟随显示第一只股票的涨跌幅；点状态栏 🔄 手动刷新

### 操作速查

| 操作 | 入口 |
|------|------|
| 切换网格 / 列表 | 工具栏视图按钮 |
| 排序 | 工具栏下拉，或列表视图点击列标题 |
| 置顶 / 拖拽排序 | 点击卡片或行；非批量模式下拖拽 |
| 重命名 / 删除分组 | 右键分组名称 |
| 自定义列 | 工具栏 ⚙（勾选 + 拖拽调序） |
| 隐藏价格 | 工具栏 👁 |
| 手动刷新 | 底部状态栏 🔄 |
| 看分时 / K线 | 点击任意股票行 / 卡片 / 指数条 |
| 悬停详情 | 鼠标停在行 / 卡片上（16 项指标 + 迷你走势） |

### 看懂行情状态

| 状态 | 样式 | 含义 |
|------|------|------|
| 实时 | 红涨绿跌 | 30 秒内从行情源获取 |
| 缓存 | 灰色 + `旧 HH:MM` | 行情源暂不可用，展示 7 天内的本地缓存 |
| 缺失 | 灰色 `--` | 无可用数据（停牌、缓存超 7 天或损坏） |

状态栏汇总显示「实时 N · 缓存 M」；角标在缓存状态下灰显数字并标注过期时间。

## 更新历史

| 版本 | 要点 |
|------|------|
| **v2.6.0** | 大盘指数条（上证/深成/创业板/科创50 + 迷你走势，点击进详情）；指数可进自选；详情面板分时 + 日/周/月K线（量能副图、十字光标、MA 均线，canvas 自绘零依赖）；hover 迷你分时；涨跌停规则推导（真值优先 + 板块幅度归一）；技术债清偿（迷你图绘制单一真相） |
| **v2.0.1** | 列设置修复（排序/卡片视图生效/取消弹回）、详情面板丰富（5→16 项双栏）、「多选」改名「管理持仓」、成交额以亿为主、行情字段扩展（换手率/振幅/量比/市盈率/市净率/市值/涨跌停）；实网核对修正东财 f51/f52 非涨跌停，备源改为腾讯 |
| **v2.0.0** | 基础架构重建：TypeScript + 原生 ESM + Light DOM Web Components；单一 StorageCoordinator 串行临界区 + 内容 revision 乐观并发；版本化 RPC v2（requestId / expectedRevision / 结构化错误）；可重试初始化屏障 + 持久化退避；不可变 Store + 语义 Commands + uncertain 对账；架构边界 / 无障碍 / 性能 / 容量门禁 |
| **v1.2.1** | 「全部」改计算视图；schema v2 自动迁移（含备份）；行情三态如实标注；缓存灰显角标；串行写入防数据丢失；E2E + CI 质量门禁；移除 Demo 模拟价格 |
| v1.2.0 | 底部状态栏（更新时间 + 手动刷新）；角标按排序联动；tooltip 显示排序后前 5 只 |
| v1.1.0 | 科创板 / 北交所支持；搜索 API 联想补全；搜索防抖防竞态 |
| v1.0.1 | 价格隐藏状态修复；列表虚拟滚动（>50 只） |
| v1.0.0 | 首个正式版：分组看板、双视图、拖拽排序、自定义列、智能搜索 |

完整日志见 [CHANGELOG.md](CHANGELOG.md)。

## 行情数据源

| 优先级 | 来源 | 说明 |
|:--:|------|------|
| 1 | 东方财富 `push2.eastmoney.com` | 主源，JSON，实时行情 |
| 2 | 腾讯 `qt.gtimg.cn` | 备源（含涨停/跌停真值） |
| 3 | 东方财富 `push2his.eastmoney.com` | 历史行情（分时/K线，详情面板与迷你图） |
| 4 | 本地缓存 `quoteCache:*` | 双源失败时保留 7 天，过期或损坏显示 `--` |

## 隐私

自选股、分组与看板配置仅保存在本地浏览器，开发者不收集不上传。查询行情时仅把股票代码发送给行情服务商，不包含姓名、邮箱、浏览记录或分组名称。详情见 [隐私政策](extension/privacy/index.html)。

## 开发

零框架、零运行时第三方依赖（Manifest V3 + TypeScript + 原生 ES Modules + Chrome Storage）。源码在 `src/`，经 `tsc` 输出到 `build/extension/`，开发者模式和 Playwright 均加载 `build/extension/`。

```bash
npm install          # 安装开发依赖
npm run build        # TypeScript 编译 → build/extension/
npm run check        # 类型 + lint + 架构边界 + 构建产物 + manifest 校验
npm run test:unit    # 单元测试（覆盖率门禁 90/85/90/90）
npm run test:component  # 组件测试（happy-dom）
npm run test:e2e     # Playwright 真实扩展 E2E（加载 build/extension/）
npm run test:a11y    # axe-core 无障碍扫描
npm run ci           # 完整本地门禁
npm run release:verify  # 发布验证（含回滚 + 确定性构建）
```

| 目录 | 职责 |
|------|------|
| `src/domain/` | 领域模型（StockCode / Group / Quote / BoardConfig / Chart / 涨跌停规则 / 指数目录 / 格式化），纯 ES2022 |
| `src/protocol/` | RPC v2 单一注册表（14 方法 / payload / result / 运行时校验） |
| `src/application/` | 用例（Bootstrap / Portfolio Commands / QuoteService / SearchService / ChartService）+ Ports |
| `src/infrastructure/` | Chrome Storage 适配器 + StorageCoordinator + Quote/Search/Chart Providers |
| `src/background/` | Service Worker：同步 listener 注册 + 可重试初始化屏障 + Router + Scheduler + Badge |
| `src/popup/` | 不可变 Store + Reducer + Selectors + Commands + Light DOM Web Components（含 canvas 图表） |
| `extension/` | 静态资源（manifest.json / popup.html / styles / icons / privacy） |
| `build/extension/` | tsc 输出 + 静态资源复制的可加载扩展（gitignored） |


更多技术细节见 [docs/项目架构.md](docs/项目架构.md) 与 `docs/module-*.md` 模块笔记；完整文档索引见 [docs/README.md](docs/README.md)。

## 贡献与安全

- [CONTRIBUTING.md](CONTRIBUTING.md) — 开发环境、提交流程、测试体系、门禁命令
- [SECURITY.md](SECURITY.md) — 安全漏洞报告渠道与响应时效
- 开发规范唯一权威见 [AGENTS.md](AGENTS.md)（Qoder / 通用 Agent 入口）、[CLAUDE.md](CLAUDE.md)（Claude Code 入口）

## 许可证

MIT
