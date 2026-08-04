// tests/helpers/chrome-runtime-mock.ts
// Chrome runtime mock：为 main.test.ts 提供完整的 chrome.* API 模拟。
// 捕获 listener 注册、alarm 调度、badge/action 设置、storage 读写。
// 在 import main.ts 之前安装到 globalThis.chrome。

/** 已注册的 listener 函数集合。 */
export interface CapturedListeners {
  onMessage: Array<(...args: unknown[]) => unknown>;
  onAlarm: Array<(alarm: { name: string; scheduledTime: number }) => void>;
  onInstalled: Array<(details: unknown) => void>;
  onStartup: Array<() => void>;
  onStorageChanged: Array<(changes: Record<string, unknown>, area: string) => void>;
}

/** Chrome mock 状态：测试可读取/操作这些字段进行断言。 */
export interface ChromeRuntimeMock {
  listeners: CapturedListeners;
  alarms: Record<string, { scheduledTime: number }>;
  alarmCreates: Array<{ name: string; delayInMinutes: number }>;
  badgeText: string;
  badgeColor: string;
  actionTitle: string;
  localStorage: Record<string, unknown>;
  sessionStorage: Record<string, unknown>;
  manifestVersion: string;
}

/**
 * 安装 Chrome mock 到 globalThis.chrome，返回可断言的状态对象。
 * 同时安装 fetch mock（防止测试中发网络请求）。
 */
export function installChromeMock(version = '2.0.0'): ChromeRuntimeMock {
  const mock: ChromeRuntimeMock = {
    listeners: {
      onMessage: [],
      onAlarm: [],
      onInstalled: [],
      onStartup: [],
      onStorageChanged: []
    },
    alarms: {},
    alarmCreates: [],
    badgeText: '',
    badgeColor: '',
    actionTitle: '',
    localStorage: {},
    sessionStorage: {},
    manifestVersion: version
  };

  const chromeMock = {
    runtime: {
      onMessage: {
        addListener: (fn: (...args: unknown[]) => unknown): void => {
          mock.listeners.onMessage.push(fn);
        }
      },
      onInstalled: {
        addListener: (fn: (details: unknown) => void): void => {
          mock.listeners.onInstalled.push(fn);
        }
      },
      onStartup: {
        addListener: (fn: () => void): void => {
          mock.listeners.onStartup.push(fn);
        }
      },
      getManifest: (): { version: string } => ({ version: mock.manifestVersion })
    },
    alarms: {
      onAlarm: {
        addListener: (fn: (alarm: { name: string; scheduledTime: number }) => void): void => {
          mock.listeners.onAlarm.push(fn);
        }
      },
      get: async (name: string): Promise<{ name: string; scheduledTime: number } | null> => {
        const existing = mock.alarms[name];
        return existing ? { name, scheduledTime: existing.scheduledTime } : null;
      },
      create: async (name: string, info: { delayInMinutes?: number }): Promise<void> => {
        const delay = info.delayInMinutes ?? 0;
        mock.alarmCreates.push({ name, delayInMinutes: delay });
        mock.alarms[name] = { scheduledTime: Date.now() + delay * 60_000 };
      }
    },
    storage: {
      onChanged: {
        addListener: (fn: (changes: Record<string, unknown>, area: string) => void): void => {
          mock.listeners.onStorageChanged.push(fn);
        }
      },
      local: {
        get: async (keys?: string | readonly string[] | null): Promise<Record<string, unknown>> => {
          if (keys === null || keys === undefined) {
            return structuredClone(mock.localStorage);
          }
          const list = typeof keys === 'string' ? [keys] : [...keys];
          const result: Record<string, unknown> = {};
          for (const key of list) {
            if (key in mock.localStorage) {
              result[key] = structuredClone(mock.localStorage[key]);
            }
          }
          return result;
        },
        set: async (patch: Readonly<Record<string, unknown>>): Promise<void> => {
          Object.assign(mock.localStorage, structuredClone(patch));
        },
        remove: async (keys: string | readonly string[]): Promise<void> => {
          const list = typeof keys === 'string' ? [keys] : [...keys];
          for (const key of list) delete mock.localStorage[key];
        }
      },
      session: {
        get: async (keys?: string | readonly string[] | null): Promise<Record<string, unknown>> => {
          if (keys === null || keys === undefined) {
            return structuredClone(mock.sessionStorage);
          }
          const list = typeof keys === 'string' ? [keys] : [...keys];
          const result: Record<string, unknown> = {};
          for (const key of list) {
            if (key in mock.sessionStorage) {
              result[key] = structuredClone(mock.sessionStorage[key]);
            }
          }
          return result;
        },
        set: async (patch: Readonly<Record<string, unknown>>): Promise<void> => {
          Object.assign(mock.sessionStorage, structuredClone(patch));
        },
        remove: async (keys: string | readonly string[]): Promise<void> => {
          const list = typeof keys === 'string' ? [keys] : [...keys];
          for (const key of list) delete mock.sessionStorage[key];
        }
      }
    },
    action: {
      setBadgeText: async (details: { text: string }): Promise<void> => {
        mock.badgeText = details.text;
      },
      setBadgeBackgroundColor: async (details: { color: string }): Promise<void> => {
        mock.badgeColor = details.color;
      },
      setTitle: async (details: { title: string }): Promise<void> => {
        mock.actionTitle = details.title;
      }
    }
  };

  (globalThis as Record<string, unknown>).chrome = chromeMock;

  // 安装 fetch mock（防止测试中网络请求）
  if (!(globalThis as Record<string, unknown>).fetch) {
    (globalThis as Record<string, unknown>).fetch = async (): Promise<Response> => {
      throw new Error('fetch not available in test');
    };
  }

  return mock;
}
