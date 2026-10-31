import { CHANNEL, VISUALS_HASH, type VisualsMessage } from './protocol';

/**
 * Drift-window side: opens the visuals window and streams events to it.
 * Uses the window reference (works for file:// too) and a BroadcastChannel
 * (for a visuals window opened by hand or after a reload of this window).
 */
export class VisualsLink {
  private win: Window | null = null;
  private channel: BroadcastChannel | undefined;
  private listeners = new Set<() => void>();
  /** A visuals window said hello recently. */
  connected = false;
  onHello: (() => void) | undefined;

  constructor() {
    try {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (e) => this.receive(e.data as VisualsMessage);
    } catch {
      this.channel = undefined;
    }
    window.addEventListener('message', (e) => {
      if (e.source && e.source === this.win) this.receive(e.data as VisualsMessage);
    });
  }

  private receive(msg: VisualsMessage): void {
    if (msg?.t === 'hello') {
      this.connected = true;
      this.onHello?.();
      this.changed();
    } else if (msg?.t === 'bye') {
      this.connected = false;
      this.changed();
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.listeners.forEach((l) => l());
  }

  open(): void {
    if (this.win && !this.win.closed) {
      this.win.focus();
      return;
    }
    const url = location.href.split('#')[0] + VISUALS_HASH;
    this.win = window.open(url, 'drift-visuals', 'popup,width=1280,height=720');
  }

  get active(): boolean {
    return this.connected || (!!this.win && !this.win.closed);
  }

  send(msg: VisualsMessage): void {
    if (!this.active) return;
    if (this.win && !this.win.closed) {
      try {
        this.win.postMessage(msg, '*');
        return;
      } catch {
        /* fall through to the channel */
      }
    }
    this.channel?.postMessage(msg);
  }
}

/** performance.now() in this window → epoch ms that any window can convert. */
export function toEpoch(timeMs: number): number {
  return performance.timeOrigin + timeMs;
}
