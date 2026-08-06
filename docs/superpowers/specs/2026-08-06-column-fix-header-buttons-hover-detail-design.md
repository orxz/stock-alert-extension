# 列设置修复 + Header 按钮调整 + 悬停详情

> 日期：2026-08-06
> 状态：已确认

## 背景

用户反馈三个问题：
1. 列设置功能：列顺序不生效（表格列顺序硬编码）；勾选/取消在网格视图下无反馈
2. Header 添加按钮文案太短（"添加"），价格切换图标无睁眼/闭眼状态变化
3. 鼠标悬停股票列表/卡片时缺少详细行情数据

## 任务 1：修复列设置——列顺序生效

### 诊断
- `stock-table.ts` 的 `COLUMNS` 数组硬编码为 `name→price→changePercent→amount`
- 列设置面板的上下移动只改变复选框顺序，不影响实际表格列顺序
- `selectBoard` 只传 `enabled` 集合，未传 `order`

### 方案
- `selectBoard` 传入完整列顺序（`order` 中属于主列的部分）
- `stock-table` 新增 `columnOrder` setter；收到新顺序后重建 `<colgroup>` + `<thead>`
- `createRow` 按当前 `columnOrder` 顺序生成数据 `<td>`
- `code`/`status` 仍为名称列副标题，不参与列重排

### 影响文件
- `src/popup/store/selectors.ts`（`selectBoard` 传 order）
- `src/popup/view-models.ts`（`BoardViewModel.columns` 改为有序数组）
- `src/popup/components/stock-table.ts`（重建表头 + 行列顺序）
- `src/popup/components/stock-board.ts`（传递 order）
- 对应测试

## 任务 2：Header 按钮调整

### 方案
- `stock-header.ts`：添加按钮 `添加` → `添加股票`
- 价格按钮：`applyViewModel` 中根据 `priceHidden` 切换 SVG
  - 可见：睁眼（带瞳孔圆）
  - 隐藏：闭眼（带斜划线）

### 影响文件
- `src/popup/components/stock-header.ts`
- `tests/component/stock-header.test.ts`

## 任务 3：悬停股票详情

### 方案
扩展全链路行情字段，列表行/卡片内嵌 CSS hover 详情面板。

### 数据链路
1. `domain/quote.ts`：`Quote` 新增可选字段 `open?/high?/low?/prevClose?/volume?`
2. `provider-parsers.ts`：`enrichQuote` 保留 f15/f16/f17/f18/f5（东财）与对应腾讯字段
3. `view-models.ts`：`StockCardViewModel` 新增详情展示字段
4. `stock-table.ts` / `stock-card.ts`：行/卡片内嵌 `.stock-detail-tooltip`，CSS `:hover` 显示
5. 详情内容：今开 / 最高 / 最低 / 昨收 / 成交量

### 影响文件
- `src/domain/quote.ts`
- `src/infrastructure/quote-providers/provider-parsers.ts`
- `src/popup/view-models.ts`
- `src/popup/store/selectors.ts`
- `src/popup/components/stock-table.ts`
- `src/popup/components/stock-card.ts`
- `extension/popup/styles/board.css` / `controls.css`
- 对应测试

## 测试策略
- TDD：先写失败测试再实现
- 单元测试：Quote 字段扩展、parser 解析、view-model 投影
- 组件测试：列顺序重建、header 图标切换、详情面板渲染
- E2E：列重排后表格列顺序正确

## 增量修订（2026-08-06 实现期）

> 按用户后续要求，在原设计基础上扩展：列设置全面修复并支持卡片视图；详情面板大幅丰富。

### 修订 1：列设置面板排序修复
- **问题**：面板中 code/status 也有 ↑↓ 按钮，但它们是名称列副标题、不参与列重排——移动后表格毫无反应，造成「排序有问题」的困惑
- **方案**：`selectColumnPanel` 把主列排前、code/status 固定尾部；`column-panel` 对副标题项禁用 ↑↓ 并加 `--subline` 弱化样式（overlays.css 附注「副标题」）

### 修订 2：列设置在卡片视图生效
- **方案**：`stock-card` 新增 `columns` setter（`ColumnKey[] | null`），按 enabled 集合显隐 code 副标题 / status 标签 / 成交额；卡片新增成交额元素（状态行右侧，`margin-left: auto`）；`stock-grid` 透传 `columns`；`stock-board` 网格分支传 `vm.enabledColumns`
- **规则**：name/price/changePercent 是必需列，卡片始终显示；`hidden` 原生属性不被行内 display 覆盖（`.stock-card [hidden] { display: none }`）
- **类型**：`BoardViewModel.enabledColumns/columns` 收紧为 `readonly ColumnKey[]`

### 修订 3：详情面板丰富（5 → 16 项）
- **新增字段**：成交额、涨跌额、换手率、振幅、量比、市盈率、市净率、总市值、流通市值、涨停价、跌停价
- **数据链路**：`Quote` 新增 9 个可选字段（turnoverRate/amplitude/volumeRatio/pe/pb/totalMarketCap/floatMarketCap/limitUp/limitDown）；东财 fields 加 f7/f8/f9/f10/f20/f21/f23；腾讯解析 [38][39][43][44][45][46][47][48][49]
- **涨停/跌停仅腾讯源**（2026-08-06 实网核对修正）：东财 f51/f52 只在逐只的 `stock/get` 上是涨跌停价；本项目用的批量接口 `ulist.np/get` 上这两个槽位是无关量纲（实测 sh600519 = 271524528742.4 / 22132684069.8，sz000001 = 0 / 10879000000），且该 endpoint f1–f300 全扫无真实涨跌停字段。改用逐只接口 = 500 只自选股 500 次请求，不可接受；故主源不提供该两项，展示层按既有缺失约定渲染 `--`
- **单位约定**：市值统一为元——腾讯以亿上报（[44]/[45]）在 parser 层 ×1e8 换算；展示按万/亿/万亿分级
- **缺失语义**：enrichQuote 条件展开，源数据缺失即 undefined → 展示 `--`；涨停/跌停是价格类字段，价格隐藏时掩码 `****`；比率/市值类不受价格隐藏影响
- **布局**：tooltip 改为每项一个 `.stock-detail-item`（label+value），双栏 grid（8 行 × 2 项），控制浮层高度

### 变更文件（增量）
- `src/popup/components/column-panel.ts`、`stock-card.ts`、`stock-grid.ts`、`stock-board.ts`、`stock-table.ts`
- `src/popup/store/selectors.ts`、`src/popup/view-models.ts`
- `src/domain/quote.ts`、`src/infrastructure/quote-providers/provider-parsers.ts`、`eastmoney-quote-provider.ts`
- `extension/popup/styles/board.css`、`overlays.css`
- 对应单元/组件测试

### 修订 4：锁定列收敛（取消不再弹回）

> 用户反馈「列设置不能取消」——原设计把名称/现价/涨跌幅都列为必需列，取消即强制弹回。

- **评估结论**：锁定列收敛为只有「名称」——它是列表的语义锚点、详情 tooltip 的挂载点、code/status 副标题的容器，去掉后列表失去意义；现价/涨跌幅放开为普通可配置列（与全局价格隐藏功能一致）
- **锁定语义**：`REQUIRED_COLUMNS = ['name']`；`normalizeUiColumns` 强制 name 存在且位于 order 首位（面板提交的 order 不含 name 时自动前置补齐，旧数据位置错误时纠正）
- **面板 5 项**：`selectColumnPanel` 不输出 name——面板只展示现价/涨跌幅/成交额（可勾选+可排序）+ 代码/状态（副标题只勾选）；`column-panel` 删除 REQUIRED_COLUMNS 强制弹回逻辑
- **卡片联动**：`stock-card.applyColumns` 扩展为按列设置显隐 code/status/price/changePercent/amount；name 与涨跌额（change，不在列设置中）始终显示
- **持久化兼容**：旧 localStorage 中 name 不在首位的 order 会被规范化纠正，无迁移成本
