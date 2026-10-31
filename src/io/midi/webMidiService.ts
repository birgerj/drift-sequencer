import type { MidiOutputPort, MidiPortResolver } from './output';

class WebMidiOutput implements MidiOutputPort {
  constructor(private readonly port: MIDIOutput) {}

  get id(): string {
    return this.port.id;
  }

  get name(): string {
    return this.port.name ?? this.port.id;
  }

  send(data: readonly number[], timestamp?: number): void {
    this.port.send([...data], timestamp);
  }
}

/**
 * Wraps the Web MIDI API (Chrome, Edge, Firefox). Each physical port of a
 * multi-port USB interface shows up as its own output, each with 16 channels.
 */
export class WebMidiService implements MidiPortResolver {
  private access: MIDIAccess | undefined;
  private listeners = new Set<() => void>();

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  /** Port wrappers by name; rebuilt only when devices change (lookups happen every step). */
  private byNameCache = new Map<string, MidiOutputPort>();
  private names = '';
  private inputNames: string[] = [];
  private messageListeners = new Set<(port: string, data: Uint8Array, timeStamp: number) => void>();

  async connect(): Promise<void> {
    if (!WebMidiService.isSupported()) throw new Error('Web MIDI is not supported in this browser.');
    if (this.access) return;
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.rebuild();
    this.access.onstatechange = () => {
      // Opening a port also fires statechange; only notify when the set of
      // connected outputs really changed.
      if (this.rebuild()) this.listeners.forEach((l) => l());
    };
  }

  get connected(): boolean {
    return this.access !== undefined;
  }

  /** Returns true if the list of connected outputs changed. */
  private rebuild(): boolean {
    const outs = this.access ? [...this.access.outputs.values()].filter((p) => p.state === 'connected') : [];
    const ins = this.access ? [...this.access.inputs.values()].filter((p) => p.state === 'connected') : [];
    // Listen to every input; Drift decides per device what to do with it.
    for (const input of ins) {
      const name = input.name ?? input.id;
      input.onmidimessage = (e: MIDIMessageEvent) => {
        if (!e.data || e.data.length === 0) return;
        const status = e.data[0]!;
        // Clock, active sensing and other real-time bytes are ignored for now.
        if (status >= 0xf8) return;
        this.messageListeners.forEach((l) => l(name, e.data!, e.timeStamp));
      };
    }
    const inNames = ins.map((p) => p.name ?? p.id);
    const inputsChanged = inNames.join('|') !== this.inputNames.join('|');
    this.inputNames = inNames;
    const names = outs.map((p) => `${p.id}:${p.name}`).join('|');
    if (names === this.names && !inputsChanged) return false;
    if (names === this.names) return false;
    this.names = names;
    this.byNameCache = new Map(outs.map((p) => [p.name ?? p.id, new WebMidiOutput(p)]));
    return true;
  }

  all(): MidiOutputPort[] {
    return [...this.byNameCache.values()];
  }

  byName(name: string): MidiOutputPort | undefined {
    return this.byNameCache.get(name);
  }

  /** Names of connected MIDI inputs. */
  inputs(): string[] {
    return [...this.inputNames];
  }

  /** Incoming MIDI from any input (no real-time messages). */
  onMessage(listener: (port: string, data: Uint8Array, timeStamp: number) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  /** Fires when devices are plugged in or removed. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
