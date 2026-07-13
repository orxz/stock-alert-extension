# v1.1.0 科创板与北交所全市场支持 — 架构决策记录

## 背景

v1.0.0 版本仅支持沪市（sh）和深市（sz）两个市场。随着科创板（2019 年开市）和北交所（2021 年成立）的成熟，用户需要管理全市场的 A 股。v1.1.0 的目标是无缝扩展到科创板和北交所，保持与现有沪市/深市完全一致的用户体验。

## 核心决策

### 1. 搜索过滤：Classify → SecurityType 白名单

**问题**：东方财富搜索 API 中，科创板股票的 `Classify` 为 `'23'`（非 `'AStock'`），北交所为 `'NEEQ'`。旧代码用 `Classify === 'AStock'` 过滤，完全遗漏这两类。

**方案**：改用 `SecurityType` 字段白名单过滤：
```javascript
const VALID_SEC_TYPES = ['1', '2', '25', '27'];
// 1=沪A, 2=深A, 25=科创板, 27=京A(北交所)
```

**否决方案**：扩展 Classify 白名单（`['AStock', '23', 'NEEQ']`）——Classify 值不稳定，不同接口版本可能变化；SecurityType 是更可靠的证券类型标识。

### 2. 行情请求：f13 市场字段

**问题**：东方财富 push2 API 的 fields 参数中必须显式包含 `f13`，否则 API 不返回该字段。旧代码 fields 中无 `f13`，导致响应解析时无法区分市场。

**发现过程**：通过 curl 对比测试发现：
- 请求不含 f13 → 响应不含 f13 → 前缀判断全部 fallback 到默认值
- 请求含 f13 → 响应含 f13 → 可正确区分市场

**修复**：`fields` 从 `'f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18'` 改为 `'f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18'`

### 3. 北交所 secids 映射

**问题**：北交所 `bj` 前缀的股票在东方财富 secids 中 market=0（与深市相同），不能用 market 单独区分。

**方案**：
- 请求方向：`bj` 前缀 → `0.{code}`（market=0）
- 响应方向：`f13=0` 时，用代码首位数字区分：
  - `4xx/8xx/9xx` 开头 → `bj`
  - 其他 → `sz`

**API 验证**：通过 curl 实测确认：
- `0.920185` → 贝特瑞（北交所），f13=0 ✓
- `1.688981` → 中芯国际（科创板），f13=1 ✓
- `0.920185`（用 market=1 测试）→ 返回 rc=102 错误 ✓

### 4. 代码前缀自动补全

**规则**：
```
4/8/9 开头  → bj（北交所）
6/5/11/12/13 开头 → sh（沪市/科创板）
其他 → sz（深市/创业板）
```

**校验正则**：`/^(sh|sz|bj)\d{6}$/`

### 5. 全局正则更新

项目中所有 `replace(/^(sh|sz)/, ...)` 正则均更新为 `replace(/^(sh|sz|bj)/, ...)`，涉及 5 处：
- `quotes.js._toSecids` — secids 映射
- `quotes.js.searchStocks` — 搜索结果前缀映射
- `quotes.js._fetchEastmoney` — 响应解析
- `popup.js._asyncSearch` — 本地搜索降级
- `popup.js.getGroupStocks` — 看板搜索过滤

## 验证方式

通过 curl 对东方财富 API 进行端到端测试：

```bash
# 科创板
curl 'https://push2.eastmoney.com/api/qt/ulist.np/get?...&secids=1.688981'
# → f13=1, prefix=sh ✓

# 北交所
curl 'https://push2.eastmoney.com/api/qt/ulist.np/get?...&secids=0.920185'
# → f13=0, code[0]=9, prefix=bj ✓
```

模拟逻辑验证：所有 4 个市场的 secids 映射、前缀重构、前缀补全校验全部通过。
