// src/infrastructure/storage/chrome-storage-adapter.ts
// ChromeStorageAdapter：将 chrome.storage.local 适配为 StorageArea 接口。
// 仅在生产环境（Service Worker / Popup）使用；测试用 MemoryStorageArea。
import type { StorageArea } from './storage-area.js';

/**
 * Chrome storage.local 适配器：实现 StorageArea 接口。
 * 直接委托 chrome.storage.local 的 get/set/remove，无额外逻辑。
 */
export class ChromeStorageAdapter implements StorageArea {
  async get(
    keys?: readonly string[] | string | null
  ): Promise<Record<string, unknown>> {
    return chrome.storage.local.get(
      keys as string | string[] | object | null | undefined
    );
  }

  async set(patch: Readonly<Record<string, unknown>>): Promise<void> {
    await chrome.storage.local.set(patch);
  }

  async remove(keys: readonly string[] | string): Promise<void> {
    await chrome.storage.local.remove(keys as string | string[]);
  }
}

/** 创建 ChromeStorageArea 实例的工厂函数。 */
export function createChromeStorageArea(): StorageArea {
  return new ChromeStorageAdapter();
}
