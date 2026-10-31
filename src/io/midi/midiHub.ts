import { LOCAL_SYNTH_PORTS, isLocalPort, wakeLocalAudio } from '../local/localSynths';
import type { MidiOutputPort, MidiPortResolver } from './output';
import { WebMidiService } from './webMidiService';

/**
 * All outputs Drift can play: hardware via Web MIDI plus the built-in
 * Drift Synth ports, which work without Web MIDI (e.g. in Safari).
 */
export class MidiHub implements MidiPortResolver {
  readonly web = new WebMidiService();

  /** True once Web MIDI is connected; the local ports are always there. */
  get connected(): boolean {
    return this.web.connected;
  }

  async connect(): Promise<void> {
    if (!WebMidiService.isSupported()) return;
    await this.web.connect();
  }

  all(): MidiOutputPort[] {
    return [...this.web.all(), ...LOCAL_SYNTH_PORTS];
  }

  byName(name: string): MidiOutputPort | undefined {
    return this.web.byName(name) ?? LOCAL_SYNTH_PORTS.find((p) => p.name === name);
  }

  inputs(): string[] {
    return this.web.inputs();
  }

  onMessage(listener: (port: string, data: Uint8Array, timeStamp: number) => void): () => void {
    return this.web.onMessage(listener);
  }

  onChange(listener: () => void): () => void {
    return this.web.onChange(listener);
  }

  /** Start audio for the Drift Synth ports if any of these is one. Call from a click. */
  async wakeAudioFor(portNames: string[]): Promise<void> {
    if (portNames.some(isLocalPort)) await wakeLocalAudio();
  }
}
