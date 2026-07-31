# quotes.js — 行情数据层

## overview

行情传输与解析模块，仅负责股票搜索和行情请求/解析，不做数据生成。提供东方财富（主源）与新浪财经（备源）两个可注入 `fetchImpl` 的传输方法；降级、超时、分批、缓存与状态编排统一由 `quote-service.js` 的 `QuoteService` 负责。支持沪深主板、科创板、创业板、北交所全市场股票。

## architecture_design

核心对象 `Quotes`，单例模式，被 `popup.js` 和 `background.js` 共同引用。

```
Quotes
├── searchStocks(keyword)    — 股票搜索（东财搜索 API）
├── fetchEastmoney(codes, { fetchImpl, signal }) — 东方财富 push2 API
│   ├── _toSecids(codes)      — 代码→secids 映射
│   └── 响应解析（f12/f13/f14...）
├── fetchSina(codes, { fetchImpl, signal }) — 新浪财经 API（GBK 编码）
│   └── parseSina(text, codes)
├── enrich(q)                — 数值安全处理 + 涨跌额/幅计算
└── _num(v)                  — 停牌股票 "-" → null 转换
```

## tech_stack

- 东方财富 push2 API：`https://push2.eastmoney.com/api/qt/ulist.np/get`（JSON/UTF-8）
- 东方财富搜索 API：`https://searchapi.eastmoney.com/api/suggest/get`
- 新浪财经：`https://hq.sinajs.cn/list=`（GBK 编码，需 TextDecoder('gbk')）
- 无第三方库依赖，纯原生 fetch

## api_contract

### 东方财富 push2 行情 API

**请求**：`GET https://push2.eastmoney.com/api/qt/ulist.np/get`
- 参数：`fltt=2&fields=f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18&secids=1.600519,0.000001`
- secids 格式：`{market}.{code}`，market: 0=深市/北交所, 1=沪市

**字段映射**：

| 字段 | 含义 |
|------|------|
| f2 | 现价 |
| f3 | 涨跌幅 |
| f4 | 涨跌额 |
| f5 | 成交量 |
| f6 | 成交额 |
| f12 | 股票代码（纯数字） |
| f13 | 市场标识（0=SZ/BJ, 1=SH） |
| f14 | 股票名称 |
| f15 | 最高 |
| f16 | 最低 |
| f17 | 今开 |
| f18 | 昨收 |

**关键**：f13 字段必须在 fields 参数中显式请求，否则 API 不会返回该字段。

### 东方财富搜索 API

**请求**：`GET https://searchapi.eastmoney.com/api/suggest/get`
- 参数：`input={关键词}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=15`

**SecurityType 白名单**（v1.1.0）：

| SecurityType | 含义 | 前缀映射 |
|--------------|------|----------|
| 1 | 沪A | sh |
| 2 | 深A | sz |
| 25 | 科创板 | sh |
| 27 | 京A（北交所） | bj |

注意：科创板 Classify='23'（非 'AStock'），北交所 Classify='NEEQ'。旧代码用 `Classify === 'AStock'` 过滤会完全遗漏这两类。

## gotchas_and_constraints

### f13 字段缺失陷阱

东方财富 push2 API 的 fields 参数中必须包含 `f13`，否则响应中不会返回市场标识，导致无法区分深市（sz）和北交所（bj）——两者 market 均为 0。

### 北交所代码识别

f13=0 时，深市和北交所都返回 market=0，需通过代码首位数字区分：
- `4xx/8xx/9xx` 开头 → bj（北交所）
- 其他 → sz（深市）

### 新浪 Referer 限制

浏览器扩展中 fetch 无法设置 Referer 头，新浪 API 可能返回 `Forbidden`。因此新浪仅作备用，主源失败后才尝试。

### 停牌数据处理

东财 API 对停牌股票返回 `"-"` 字符串，直接 `.toFixed()` 会崩溃。`_num()` 方法将 `"-"`/空值转为 `null`，`enrich()` 对所有数值字段做安全处理。

## coding_conventions

- 代码前缀统一小写：`sh`/`sz`/`bj`
- 传输方法不捕获异常，失败决策由 `QuoteService` 统一处理（超时/HTTP/解析分类）
- 只返回真实行情数据，任何情况下不生成模拟价格
- `enrich()` 是纯函数，不修改原始数据，返回新对象
