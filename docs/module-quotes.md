# QuoteService — 行情数据层

> 本文档描述**模块落地细节**（provider 实现 / 字段映射 / API 契约 / 陷阱）。整体架构概览见 [项目架构.md](项目架构.md)；开发规范唯一权威见根目录 [AGENTS.md](../AGENTS.md)。

## overview

v2.0.1 行情数据层按 Domain → Protocol → Application → Infrastructure 分层组织。Application 层的 `QuoteService`（`src/application/quotes/quote-service.ts`）是唯一编排者，负责批量、并发、超时、deadline、双源降级、缓存策略、退避与诊断；底层 HTTP 传输/解析被隔离在 Infrastructure 层的两个可注入 Provider（东财主源 + 腾讯备源），通过 `QuoteProvider` 端口对接。Provider 是纯传输/解析适配器，不做缓存、不做 UI、不持有状态。支持沪深主板、科创板、创业板、北交所全市场股票。

## architecture_design

### 分层与依赖

```
Application
├── ports/quote-provider.ts        QuoteProvider 端口（eastmoney | tencent）
├── ports/cancellation.ts          CancellationToken / CancellationSource（纯 ES2022）
├── ports/session-state.ts         SessionStatePort + QuoteBackoffState
├── ports/clock.ts / diagnostics.ts 注入的时钟与诊断 sink
└── quotes/quote-service.ts        QuoteService 编排核心
Infrastructure
├── quote-providers/eastmoney-quote-provider.ts   东财传输适配器（注入 fetch）
├── quote-providers/tencent-quote-provider.ts     腾讯传输适配器（GBK 解码）
├── quote-providers/eastmoney-search-provider.ts  东财搜索适配器
├── quote-providers/local-stock-catalog.ts        本地股票目录（搜索降级）
├── quote-providers/provider-parsers.ts           纯解析器（无 fetch 依赖）
└── chrome/chrome-session-state.ts                SessionStatePort 的 chrome.storage.session 实现
```

### QuoteProvider 端口

```ts
interface QuoteProvider {
  readonly name: 'eastmoney' | 'tencent';
  fetch(codes: readonly StockCode[], cancellation: CancellationToken)
    : Promise<Readonly<Record<StockCode, Quote>>>;
}
```

- `name` 标识数据来源，用于缓存标签与诊断事件。
- 返回**部分结果**：缺失的 code 不出现在结果映射中，由 `QuoteService` 统一兜底（fallback / 缓存）。
- 价格为 0 或非有限的行（A 股停牌/盘前常返回 0.00）必须丢弃。
- 实现接收**注入的 fetch**（构造器参数），不直接引用 `globalThis.fetch`；通过 `CancellationToken` 桥接到 `AbortController` 传播取消。

### CancellationToken

纯 ES2022 协作取消令牌，不引用 DOM/WebWorker `AbortSignal`：

```ts
interface CancellationToken { readonly aborted: boolean; onCancel(listener: () => void): () => void; }
interface CancellationSource { readonly token: CancellationToken; cancel(): void; }
```

- `cancel()` 幂等——多次调用安全，listener 仅触发一次。
- 已取消的 token 上 `onCancel` 立即同步触发 listener。
- Provider 内部 `linkCancellation(token)` 把 token 桥接到 `AbortController.abort()`，注入 fetch 的 `signal`。

### QuoteService 编排

`QuoteService` 构造器注入六要素：`primary`（东财）、`fallback`（腾讯）、`cache`（`read`/`write`/`delete`）、`clock`、`session`（`SessionStatePort`）、`sink`（`DiagnosticSink`）。

```
QuoteService
├── read(codes, { freshnessMs? })          纯缓存读取 → snapshotFromCache，不触发远端请求
└── refresh(codes, { force?, requestId? }) 编排刷新
    ├── uniqueCodes()                      去重 + 过滤空值
    ├── 空自选股守卫                         requested.length===0 → 返回空快照，不读 session、不触网
    ├── 退避检查                            !force && now < nextAutomaticAttemptAt → boundary(backoff-deferred) + read 兜底
    ├── singleFlight()                     同一时刻只有一个 refresh 执行，pending 请求合并为一次重跑
    └── executeRefresh()
        ├── generation++ + startSpan(runId)
        ├── cache.read(requested)
        ├── deadlineSource(8s)             clock.schedule(DEADLINE_MS) 驱动，取消所有未完成批
        ├── chunk(requested, 50)           每批 ≤50 只
        ├── runWithConcurrency(batches, 2) 最多 2 批并发
        │   └── processBatch()
        │       ├── callProvider(primary)  4s 超时 source，deadline 联动取消；price>0 入 fresh + cacheWrites
        │       └── callProvider(fallback) 仅查 primary 缺失的 code
        ├── deadline 取消 → boundary(deadline, degraded)
        ├── cache.write(fresh, price>0) / cache.delete(超期)
        ├── 结果分级                        fresh > cached(30s–7d, error='unavailable') > missing
        ├── 退避更新                        fresh>0 → 重置；fresh===0 → failureCount+1，delay=30s→2m→5m
        └── span.end(outcome, durationMs, counts)
```

**关键常量**（`quote-service.ts` 顶部）：

| 常量 | 值 | 含义 |
|------|------|------|
| `TIMEOUT_MS` | 4000 | 每批 provider 调用超时 |
| `DEADLINE_MS` | 8000 | 父级 deadline，取消所有未完成批 |
| `CHUNK_SIZE` | 50 | 批大小上限 |
| `MAX_CONCURRENCY` | 2 | 最大并发批数 |
| `DEFAULT_FRESHNESS_MS` | 30_000 | `read` 默认 fresh 窗口 |
| `CACHE_MAX_AGE_MS` | 604_800_000 | 缓存最大存活（7 天），超期删除 |
| `BACKOFF_MS` | [30_000, 120_000, 300_000] | 退避序列 30s→2m→5m（循环取末位） |

### 退避持久化

退避状态由 `SessionStatePort`（`src/application/ports/session-state.ts`）抽象：

```ts
interface QuoteBackoffState { readonly failureCount: number; readonly nextAutomaticAttemptAt: number; }
interface SessionStatePort { readQuoteBackoff(): Promise<QuoteBackoffState>; writeQuoteBackoff(state): Promise<void>; }
```

`ChromeSessionState`（`src/infrastructure/chrome/chrome-session-state.ts`）用 `chrome.storage.session` 读写 `quoteBackoff:v2` 键。**Service Worker 重建后从 session 恢复退避状态**，避免冷启动雪崩。读取时 `clampBackoff` 把负数/NaN/非数字 clamp 到零值。

### 诊断 span（exactly-once）

`src/application/diagnostics/span.ts` 的 `startSpan(sink, event)`：立即发射 `${type}:start`，返回 `{ boundary, end }`。`end` 内部 `ended` 标志保证**多次调用只发射一次** `${type}:end`（exactly-once）。每次 `refresh` 携带 `runId`（`options.requestId` 或自增 `run-${n}`）关联 start/boundary/end，便于跨 SW 生命周期追踪。事件 `version` 固定 `'2.0.0'`，`scope` 固定 `'quote'`。

## tech_stack

- 东方财富 push2 API：`https://push2.eastmoney.com/api/qt/ulist.np/get`（JSON/UTF-8，`fltt=2` 返回浮点值，无需缩放）
- 东方财富搜索 API：`https://searchapi.eastmoney.com/api/suggest/get`（由 `EastmoneySearchProvider` 实现）
- 腾讯行情：`https://qt.gtimg.cn/q=`（GBK 编码，`TextDecoder('gbk')`，代码自带市场前缀逗号分隔）
- 无第三方库依赖；Provider 接收注入的 `fetch`，测试可替换为确定性实现
- 取消信号：`CancellationToken`（纯 ES2022）→ Provider 内桥接 `AbortController`

## api_contract

### 东方财富 push2 行情 API

**请求**：`GET https://push2.eastmoney.com/api/qt/ulist.np/get`
- 参数：`fltt=2&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23&secids=1.600519,0.000001`
- secids 格式：`{market}.{code}`，映射（`EastmoneyQuoteProvider.toSecids`）：`sh → 1.`、`bj/sz → 0.`
- 响应：`json.data.diff[]`，由 `parseEastmoney` 规范化。
- **`fltt=2` 返回浮点值（元/百分比），无需 ÷100 缩放**——这是 v2 相对 v1.3 的一个澄清，旧文档曾误写为需要缩放。

**字段映射**（`provider-parsers.ts` 的 `EastmoneyRow`）：

| 字段 | 含义 |
|------|------|
| f2 | 现价 |
| f3 | 涨跌幅（%） |
| f4 | 涨跌额（元） |
| f5 | 成交量 |
| f6 | 成交额 |
| f7 | 振幅（%） |
| f8 | 换手率（%） |
| f9 | 市盈率（动态） |
| f10 | 量比 |
| f12 | 股票代码（纯数字） |
| f13 | 市场标识（0=SZ/BJ, 1=SH） |
| f14 | 股票名称 |
| f15 | 最高 |
| f16 | 最低 |
| f17 | 今开 |
| f18 | 昨收 |
| f20 | 总市值 |
| f21 | 流通市值 |
| f23 | 市净率 |

> **涨停/跌停价缺席是有意的**：批量接口 `ulist.np/get` 不提供该数据（f1–f300 实测全扫无匹配），改用逐只 `stock/get` 会让 500 只自选股从 1 次请求变成 500 次。主源缺失即 `undefined` → 展示 `--`；腾讯备源有真值时正常显示。

**关键**：f13 字段必须在 fields 参数中显式请求，否则 API 不会返回该字段。

### 东方财富搜索 API（EastmoneySearchProvider）

**请求**：`GET https://searchapi.eastmoney.com/api/suggest/get`
- 参数：`input={关键词}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=15`
- token 为公共客户端令牌（非密钥），与官网前端一致。

**SecurityType 白名单**（`parseEastmoneySearch`）：

| SecurityType | 含义 | 前缀映射 |
|--------------|------|----------|
| 1 | 沪A | sh |
| 2 | 深A | sz |
| 25 | 科创板 | sh |
| 27 | 京A（北交所） | bj |

注意：科创板 `Classify='23'`（非 `'AStock'`），北交所 `Classify='NEEQ'`。仅用 `Classify === 'AStock'` 过滤会完全遗漏这两类，故白名单以 `SecurityType ∈ {1,2,25,27}` 为主，无 SecurityType 时回退 `Classify==='AStock'`。

### 腾讯行情 API（TencentQuoteProvider，v2.0.1 起为备源）

**请求**：`GET https://qt.gtimg.cn/q=sh600519,sz000001,bj430047`
- URL 直接拼接带市场前缀的代码（逗号分隔），无需 secids 转换。
- 响应：GBK 文本，逐行 `v_<code>="..."`；字段以 `~` 分隔（88 个槽位）。
- 由 `parseTencent` 解析；`price<=0` 或非有限 → 丢弃（停牌/盘前）。

**字段映射**（`provider-parsers.ts` 的 `parseTencent`）：

| 槽位 | 含义 |
|------|------|
| [1] | 股票名称 |
| [3] | 现价 |
| [4] | 昨收 |
| [5] | 今开 |
| [31] | 涨跌额 |
| [32] | 涨跌幅（%） |
| [33] | 最高 |
| [34] | 最低 |
| [36] | 成交量 |
| [38] | 换手率（%） |
| [39] | 市盈率（动态） |
| [43] | 振幅（%） |
| [44] | 流通市值（亿，parser 层 ×1e8 换算为元） |
| [45] | 总市值（亿，parser 层 ×1e8 换算为元） |
| [46] | 市净率 |
| [47] | 涨停价 |
| [48] | 跌停价 |
| [49] | 量比 |

> 市值统一为**元**口径：腾讯以「亿」上报，`tencentCap` 在 parser 层 ×1e8 换算，与东财（元）一致。

**备源选型理由**（v2.0.1 替换新浪）：原备源 `hq.sinajs.cn` 自 2022 起强制校验 `Referer`，而 `Referer` 属于 fetch forbidden header，MV3 Service Worker 无法设置（注入需 `declarativeNetRequest` 权限，与「不新增权限」冲突）——实测扩展内固定返回 403，双源降级形同虚设。腾讯 `qt.gtimg.cn` 无此限制，实测成功率高，故替换为备源。

## gotchas_and_constraints

### f13 字段缺失陷阱

东财 push2 的 fields 参数必须包含 `f13`，否则响应不返回市场标识，无法区分深市（sz）与北交所（bj）。`parseEastmoney` 用 `f13===1?'sh':/^[489]\d{5}$/.test(code)?'bj':'sz'` 兜底——**f13=0 时按代码首位识别北交所**（`4xx/8xx/9xx` → bj，其余 → sz）。

### f51/f52 不是涨跌停价（v2.0.1 实网核对修正）

东财批量接口 `ulist.np/get` 上的 f51/f52 是**无关量纲**（实测 sh600519 f51=2715 亿、sz000001 f51=0），只有逐只的 `stock/get` 上才是涨跌停价。照搬会把「涨停价」渲染成天文数字。已从请求字段与解析中移除；涨跌停仅由腾讯备源提供。

### price>0 不变量

东财对停牌股票返回 `0.00` 或 `"-"`，直接 `.toFixed()` 会崩溃。三重保障：
1. `num()`（`provider-parsers.ts`）把 `'-'`/`''`/`null`/`undefined` → `null`。
2. `parseEastmoney`/`parseTencent` 丢弃 `price<=0` 或非有限的行（`enrichQuote` 返回 null）。
3. `QuoteService.callProvider` 仅当 `isUsableQuote(quote)`（price>0）时才写入 `freshResults` 与 `cacheWrites`。

**任何情况下不生成模拟价格**——缺失即缺失，由缓存或 `missing` 状态兜底。

### 空自选股守卫

`refresh` 在去重后若 `requested.length === 0`，直接返回空快照（仍发射 `start`/`end` span），**不读 session、不触碰 `failureCount`、不发起任何网络请求**。这是空自选股场景下的硬不变量。

### fltt=2 无需价格缩放

东财 `fltt=2` 返回的数值是**浮点值**（元/百分比），直接 `parseFloat` 使用即可，**无需 ÷100 缩放**。这是 v2 相对 v1.3 文档的一个澄清（旧文档误写为需要缩放）。所有 f 字段均如此。

### deadline 与超时的关系

- 每批 provider 调用有自己的 **4s** `CancellationSource`（`clock.schedule(TIMEOUT_MS)` 驱动）。
- 父级 **8s** deadline source 统一兜底：deadline token 取消时，各批的子 source 通过 `onCancel` 联动取消。
- deadline 触发后 `executeRefresh` 发射 `boundary(deadline, degraded)`，已拿到的 fresh 结果照常写入缓存。

### 退避持久化与 SW 重建

退避状态写 `chrome.storage.session`（`quoteBackoff:v2`）。Service Worker 被 MV3 回收后重建时，`QuoteService` 从 session 读回 `failureCount` 与 `nextAutomaticAttemptAt`，**不重置退避**——避免 SW 频繁重建导致雪崩式重试。

## coding_conventions

- 代码前缀统一小写：`sh`/`sz`/`bj`。
- Provider 是**纯传输/解析适配器**：接收注入 fetch、HTTP 非 2xx 抛错、解析后返回部分结果映射；**不做缓存、不做降级、不分类错误**——失败决策（超时/HTTP/解析）全部由 `QuoteService` 的 `try/catch` 静默吞掉并交由 fallback 或缓存兜底。
- 只返回真实行情数据，**任何情况下不生成模拟价格**。
- `enrichQuote`/`parseEastmoney`/`parseTencent` 是纯函数，不修改原始数据，返回新对象。
- Provider 实现接收注入的 `fetch`，不直接引用 `globalThis.fetch`；`CancellationToken` 桥接到 `AbortController` 在 Provider 内完成。
- 诊断事件 `version` 恒为 `'2.0.0'`、`scope` 恒为 `'quote'`；span `end` 必须被调用（exactly-once 保证幂等）。
