import type { MidiOutputPort, MidiPortResolver } from './output';

export interface GuardOptions {
  now: () => number;
  /** Most messages allowed per second across all ports before tripping. */
  maxPerSecond?: number;
  /** Messages timestamped further in the past than this are dropped. */
  staleMs?: number;
  /** Called once when the limit is exceeded. */
  onTrip: (perSecond: number) => void;
}

/**
 * Safety valve between the engine and Web MIDI. A runaway (a bug, or a burst
 * after the browser paused the page) must never flood the browser's MIDI
 * service, which can freeze the whole browser. Normal playback sends ~100–300
 * messages a second; the default limit is far above that.
 */
export class MidiGuard implements MidiPortResolver {
  private windowStart = 0;
  private count = 0;
  private tripped = false;
  private readonly wrapped = new Map<MidiOutputPort, MidiOutputPort>();
  dropped = 0;

  constructor(
    private readonly inner: MidiPortResolver,
    private readonly opts: GuardOptions,
  ) {}

  /** Re-arm after the user starts playback again. */
  reset(): void {
    this.tripped = false;
    this.count = 0;
    this.windowStart = this.opts.now();
  }

  get isTripped(): boolean {
    return this.tripped;
  }

  all(): MidiOutputPort[] {
    return this.inner.all().map((p) => this.wrap(p));
  }

  byName(name: string): MidiOutputPort | undefined {
    const p = this.inner.byName(name);
    return p ? this.wrap(p) : undefined;
  }

  private wrap(port: MidiOutputPort): MidiOutputPort {
    let w = this.wrapped.get(port);
    if (!w) {
      w = { id: port.id, name: port.name, send: (data, ts) => this.send(port, data, ts) };
      this.wrapped.set(port, w);
    }
    return w;
  }

  private send(port: MidiOutputPort, data: readonly number[], timestamp?: number): void {
    const status = data[0] ?? 0;
    // Always let "stop" and "all notes off" through, so stopping is clean.
    const essential = status === 0xfc || ((status & 0xf0) === 0xb0 && data[1] === 123);
    if (!essential) {
      if (this.tripped) return void this.dropped++;
      const now = this.opts.now();
      if (timestamp !== undefined && timestamp < now - (this.opts.staleMs ?? 150)) return void this.dropped++;
      if (now - this.windowStart >= 1000) {
        this.windowStart = now;
        this.count = 0;
      }
      if (++this.count > (this.opts.maxPerSecond ?? 3000)) {
        this.tripped = true;
        this.dropped++;
        this.opts.onTrip(this.count);
        return;
      }
    }
    port.send(data, timestamp);
  }
}
