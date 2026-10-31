/**
 * What the engine needs from a MIDI output. Web MIDI ports, a test recorder
 * or a future WebSocket bridge can all implement it.
 */
export interface MidiOutputPort {
  readonly id: string;
  readonly name: string;
  /** `timestamp` is in the performance.now() time base; omitted = now. */
  send(data: readonly number[], timestamp?: number): void;
}

/** Looks up output ports by name, which is stable across sessions (ids are not always). */
export interface MidiPortResolver {
  byName(name: string): MidiOutputPort | undefined;
  all(): MidiOutputPort[];
}

/** In-memory output that records everything sent; used in tests. */
export class RecordingOutput implements MidiOutputPort {
  readonly sent: { data: number[]; timestamp: number | undefined }[] = [];

  constructor(
    readonly id: string,
    readonly name: string = id,
  ) {}

  send(data: readonly number[], timestamp?: number): void {
    this.sent.push({ data: [...data], timestamp });
  }
}

export class StaticPortResolver implements MidiPortResolver {
  constructor(private readonly ports: MidiOutputPort[]) {}

  byName(name: string): MidiOutputPort | undefined {
    return this.ports.find((p) => p.name === name);
  }

  all(): MidiOutputPort[] {
    return [...this.ports];
  }
}
