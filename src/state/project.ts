import type { PhraseSettings } from '../core/engine/phrasing';
import type { DeviceRole } from './rack';
import type { GeneratorConfig } from '../core/generators/registry';
import type { Pattern, Register } from '../core/pattern/pattern';
import type { ProgressionStep } from '../core/theory/harmony';
import type { ProgressionStyle } from '../core/theory/progressionGenerator';
import type { PitchClass } from '../core/theory/note';
import type { ModeName } from '../core/theory/scale';

/** Bump when the stored shape changes, and add a migration in storage.ts. */
export const SCHEMA_VERSION = 1;

export interface MidiTarget {
  /** Output port name; names survive reconnects better than ids. */
  portName: string;
  /** 1..16 */
  channel: number;
}

export type LfoShape = 'sine' | 'triangle' | 'saw' | 'square' | 'random';

/** A software LFO sending a MIDI CC, e.g. to sweep a synth's filter cutoff. */
export interface CcModulation {
  id: string;
  enabled: boolean;
  /** CC number; later resolved from an instrument definition by parameter name. */
  cc: number;
  label: string;
  shape: LfoShape;
  periodBars: number;
  min: number;
  max: number;
}

export interface TrackState {
  id: string;
  name: string;
  color: string;
  generator: GeneratorConfig;
  register: Register;
  /** Fallback MIDI target, used when no rack device is assigned. */
  output: MidiTarget;
  /** The rack device (from "My devices") this track plays on. */
  deviceId?: string;
  /** Role used to pick a device automatically ('lead', 'bass', 'pad', 'drums'). */
  role?: DeviceRole;
  /** Instrument definition id; normally taken from the rack device. */
  instrumentId?: string;
  /**
   * Resolved at runtime from the instrument definition (not stored): the CC
   * that switches slide on, e.g. 102 on the TB-03.
   */
  slideCc?: number;
  muted: boolean;
  solo: boolean;
  /** Frozen tracks keep their pattern and skip mutation. */
  frozen: boolean;
  /** Mutate every N bars. */
  mutationIntervalBars: number;
  /** Seed for this track's generator, so a pattern can be reproduced. */
  seed: number;
  /**
   * A pattern the user drew or edited. It is saved with the project and is
   * where the track starts from; unfreeze the track to let it evolve.
   */
  userPattern?: Pattern;
  /** Call-and-response role; the track only plays in its own phrases. */
  phrase?: PhraseSettings;
  modulations: CcModulation[];
}

export interface ProjectState {
  schemaVersion: number;
  id: string;
  name: string;
  bpm: number;
  /** 0..0.75 */
  swing: number;
  stepsPerBar: number;
  key: { root: PitchClass; mode: ModeName };
  progression: ProgressionStep[];
  /** Let the chord progression evolve on its own while playing. */
  harmonyEvolve?: {
    enabled: boolean;
    style: ProgressionStyle;
    /** Change after this many passes through the progression. */
    everyLoops: number;
    /** 'vary' swaps one chord; 'new' writes a whole new progression. */
    mode: 'vary' | 'new';
  };
  clock: {
    /** Port names that receive MIDI clock + start/stop (e.g. the TR-8S). */
    sendTo: string[];
  };
  tracks: TrackState[];
  updatedAt: string;
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}
