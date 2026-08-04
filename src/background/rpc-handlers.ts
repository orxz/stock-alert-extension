// src/background/rpc-handlers.ts
// 穷尽式 RPC handler 表：每个 RpcMethod 恰好映射到一个 service 调用。
// `satisfies { [M in RpcMethod]: RpcHandler<M> }` 在编译期强制：
//   - 缺失条目 → 类型错误（mapped type 要求所有键）。
//   - 多余条目 → excess property 检查拒绝。
//   - handler 返回类型必须为 Promise<RpcResult<M>>。
// 注册表新增方法时，此处漏处理即编译失败——单一真相源保持同步。
import type { RpcMethod, RpcPayload, RpcResult } from '../protocol/registry.js';
import type { BootstrapResult } from '../protocol/messages.js';
import type { StockCode } from '../domain/brands.js';
import type { QuoteSnapshot, StockSearchResult } from '../domain/quote.js';
import type { PortfolioCommands } from '../application/portfolio/commands.js';
import type { ReadOptions, RefreshOptions } from '../application/quotes/quote-service.js';

/**
 * 应用服务捆绑：Background 控制平面通过此接口访问所有用例。
 * 使用结构化方法签名（而非具体类），使生产实例与测试 mock 都能结构化满足。
 */
export interface AppServices {
  readonly bootstrap: { execute(): Promise<BootstrapResult> };
  readonly portfolio: PortfolioCommands;
  readonly quotes: {
    read(codes: readonly StockCode[], options?: ReadOptions): Promise<QuoteSnapshot>;
    refresh(codes: readonly StockCode[], options?: RefreshOptions): Promise<QuoteSnapshot>;
  };
  readonly search: { search(query: string): Promise<readonly StockSearchResult[]> };
}

/** 单个 RPC 方法的 handler 签名：接收校验后的 payload 与 services，返回 result。 */
export type RpcHandler<M extends RpcMethod> = (
  payload: RpcPayload<M>,
  services: AppServices
) => Promise<RpcResult<M>>;

/**
 * handler 表：13 个方法各委托到唯一 service 方法。
 * `app:bootstrap` → BootstrapService；quote/search 用各自 service；mutation 用 PortfolioCommands。
 */
export const handlers = {
  'app:bootstrap': (_payload, services) => services.bootstrap.execute(),
  'quote:refresh': (payload, services) => services.quotes.refresh(payload.codes, { force: payload.force }),
  'stock:search': (payload, services) => services.search.search(payload.query),
  'stock:add': (payload, services) => services.portfolio.addStock(payload),
  'stock:remove': (payload, services) => services.portfolio.removeStocks(payload),
  'stock:move': (payload, services) => services.portfolio.moveStocks(payload),
  'stock:setPinned': (payload, services) => services.portfolio.setPinned(payload),
  'stock:setOrder': (payload, services) => services.portfolio.setOrder(payload),
  'group:create': (payload, services) => services.portfolio.createGroup(payload),
  'group:rename': (payload, services) => services.portfolio.renameGroup(payload),
  'group:delete': (payload, services) => services.portfolio.deleteGroup(payload),
  'group:setOrder': (payload, services) => services.portfolio.setGroupOrder(payload),
  'preferences:patch': (payload, services) => services.portfolio.patchPreferences(payload)
} satisfies { [M in RpcMethod]: RpcHandler<M> };
