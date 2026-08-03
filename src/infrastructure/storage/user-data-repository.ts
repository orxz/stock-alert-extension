// src/infrastructure/storage/user-data-repository.ts
// UserDataRepository 薄包装：接收 Coordinator，转调 readBootstrap/mutate。
// 不含队列、不持有 StorageArea——并发控制完全由 Coordinator 的单队列保证。
import type { StorageCoordinator } from './storage-coordinator.js';
import type {
  UserDataRepository,
  MutableUserData,
  BootstrapStorageSnapshot
} from '../../application/ports/storage.js';
import type { UserDataRevision } from '../../domain/brands.js';
import type { MutationResult } from '../../protocol/messages.js';

/**
 * 用户数据仓储：UserDataRepository 端口的具体实现。
 * 薄包装——所有操作转调同一 Coordinator 实例。
 */
export class UserDataRepositoryImpl implements UserDataRepository {
  constructor(private readonly coordinator: StorageCoordinator) {}

  readBootstrap(): Promise<BootstrapStorageSnapshot> {
    return this.coordinator.readBootstrap();
  }

  mutate<T>(
    expectedRevision: UserDataRevision,
    change: (draft: MutableUserData) => T | Promise<T>
  ): Promise<MutationResult<T>> {
    return this.coordinator.mutate(expectedRevision, change);
  }
}
