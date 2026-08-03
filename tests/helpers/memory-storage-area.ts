// tests/helpers/memory-storage-area.ts
// 内存 StorageArea：用于测试。structuredClone 语义（深拷贝读写）。
import type { StorageArea } from '../../src/infrastructure/storage/storage-area.js';

/**
 * 内存版 StorageArea：确定性、无 IO 延迟。
 * - get(null) 返回全部数据的深拷贝。
 * - get(keys) 返回指定键的深拷贝。
 * - set(patch) 深拷贝写入。
 * - remove(keys) 删除指定键。
 */
export class MemoryStorageArea implements StorageArea {
  private data: Record<string, unknown> = {};

  constructor(initial?: Record<string, unknown>) {
    if (initial) {
      this.data = structuredClone(initial);
    }
  }

  async get(
    keys?: readonly string[] | string | null
  ): Promise<Record<string, unknown>> {
    if (keys === null || keys === undefined) {
      return structuredClone(this.data);
    }
    const list = typeof keys === 'string' ? [keys] : [...keys];
    const result: Record<string, unknown> = {};
    for (const key of list) {
      if (key in this.data) {
        result[key] = structuredClone(this.data[key]);
      }
    }
    return result;
  }

  async set(patch: Readonly<Record<string, unknown>>): Promise<void> {
    for (const [key, value] of Object.entries(patch)) {
      this.data[key] = structuredClone(value);
    }
  }

  async remove(keys: readonly string[] | string): Promise<void> {
    const list = typeof keys === 'string' ? [keys] : [...keys];
    for (const key of list) {
      delete this.data[key];
    }
  }

  /** 测试辅助：直接访问内部数据引用（用于断言）。 */
  peek(): Record<string, unknown> {
    return this.data;
  }
}
