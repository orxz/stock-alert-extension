// tests/helpers/chrome-mock.mjs — 确定性内存版 chrome.storage.local
export function createStorageArea(initial = {}, { delayMs = 0 } = {}) {
  const data = structuredClone(initial);
  const wait = () => delayMs ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();
  return {
    data,
    async get(keys = null) {
      await wait();
      if (keys === null) return structuredClone(data);
      const list = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
    },
    async set(patch) {
      await wait();
      Object.assign(data, structuredClone(patch));
    },
    async remove(keys) {
      await wait();
      for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key];
    }
  };
}
