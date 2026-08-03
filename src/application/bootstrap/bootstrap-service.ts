// src/application/bootstrap/bootstrap-service.ts
// BootstrapService：冷启动用例——一次一致快照返回 userData + revision + quoteSnapshot。
// 通过 readBootstrap() 读取存储临界区快照，用 snapshotFromCache 派生行情快照（不二次读取存储）。
// 纯 Application 层——仅 import domain/* + protocol/* + 同层 application/*。
import type { UserDataRepository } from '../ports/storage.js';
import type { Clock } from '../ports/clock.js';
import { snapshotFromCache } from '../../domain/quote.js';
import type { BootstrapResult } from '../../protocol/messages.js';

/**
 * 冷启动用例：一次读取获得版本、用户数据、revision 和行情快照。
 *
 * 设计要点：
 * - readBootstrap() 持有存储读临界区——userData、revision、quoteCache 在同一快照中一致。
 * - snapshotFromCache() 用同一缓存派生 fresh/cached/missing 三态，不触发二次存储读取或远端刷新。
 * - clock.now() 仅用于 freshness 判定（age = now - fetchedAt）。
 */
export class BootstrapService {
  constructor(
    private readonly storage: Pick<UserDataRepository, 'readBootstrap'>,
    private readonly clock: Clock
  ) {}

  async execute(): Promise<BootstrapResult> {
    const snapshot = await this.storage.readBootstrap();
    return {
      version: '2.0.0',
      userData: snapshot.userData,
      revision: snapshot.revision,
      quoteSnapshot: snapshotFromCache(
        snapshot.quoteCache,
        snapshot.userData.watchlist.map((stock) => stock.code),
        this.clock.now()
      )
    };
  }
}
