import { browserTimerHost, type TimerHost } from './scheduler';

/**
 * Browsers throttle setInterval on the main thread when the tab is hidden
 * (to ~1 per second), which would starve the lookahead scheduler. Timers in
 * a Web Worker are not throttled that way, so a worker ticks and the main
 * thread schedules on each tick.
 *
 * The engine itself stays on the main thread because Web MIDI is not
 * available inside workers; only the clock moves.
 *
 * The worker is created from an inline Blob so it also works in the
 * single-file build and when opened from disk.
 */
const WORKER_SOURCE = `
  const timers = new Map();
  self.onmessage = (e) => {
    const { cmd, id, ms } = e.data;
    if (cmd === 'start') {
      clearInterval(timers.get(id));
      timers.set(id, setInterval(() => self.postMessage(id), ms));
    } else if (cmd === 'stop') {
      clearInterval(timers.get(id));
      timers.delete(id);
    }
  };
`;

export function createWorkerTimerHost(): TimerHost {
  let worker: Worker;
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
  } catch {
    return browserTimerHost;
  }

  const callbacks = new Map<number, () => void>();
  let nextId = 1;
  worker.onmessage = (e: MessageEvent<number>) => callbacks.get(e.data)?.();

  return {
    now: () => performance.now(),
    setInterval(fn, ms) {
      const id = nextId++;
      callbacks.set(id, fn);
      worker.postMessage({ cmd: 'start', id, ms });
      return id;
    },
    clearInterval(handle) {
      const id = handle as number;
      callbacks.delete(id);
      worker.postMessage({ cmd: 'stop', id });
    },
  };
}
