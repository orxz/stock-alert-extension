export interface RafScheduler {
  schedule(): void;
  cancel(): void;
}

export function createRafScheduler(
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void,
  task: () => void
): RafScheduler {
  let handle: number | null = null;

  return {
    schedule() {
      if (handle !== null) return;
      handle = requestFrame(() => {
        handle = null;
        task();
      });
    },
    cancel() {
      if (handle === null) return;
      cancelFrame(handle);
      handle = null;
    }
  };
}
