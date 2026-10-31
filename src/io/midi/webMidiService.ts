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

  async connect(): Promise<void> {
    if (!WebMidiService.isSupported()) throw new Error('Web MIDI is not supported in this browser.');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this.listeners.forEach((l) => l());
  }

  get connected(): boolean {
    return this.access !== undefined;
  }

  all(): MidiOutputPort[] {
    if (!this.access) return [];
    return [...this.access.outputs.values()].filter((p) => p.state === 'connected').map((p) => new WebMidiOutput(p));
  }

  byName(name: string): MidiOutputPort | undefined {
    return this.all().find((p) => p.name === name);
  }

  /** Fires when devices are plugged in or removed. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
