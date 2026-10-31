import { mod, pitchClassOf, type MidiNote, type PitchClass } from './note';

export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
} as const satisfies Record<string, readonly number[]>;

export type ModeName = keyof typeof MODES;

/**
 * A key: root pitch class plus a mode. Scale degrees are 0-based and may run
 * beyond the scale length or below zero; they wrap into neighbouring octaves.
 */
export class Scale {
  readonly intervals: readonly number[];

  constructor(
    readonly root: PitchClass,
    readonly mode: ModeName,
  ) {
    this.intervals = MODES[mode];
  }

  get size(): number {
    return this.intervals.length;
  }

  pitchClasses(): PitchClass[] {
    return this.intervals.map((i) => mod(this.root + i, 12));
  }

  contains(note: MidiNote): boolean {
    return this.pitchClasses().includes(pitchClassOf(note));
  }

  /** Pitch class of a (possibly out-of-range) degree. */
  pitchClassOfDegree(degree: number): PitchClass {
    return mod(this.root + this.intervals[mod(degree, this.size)]!, 12);
  }

  /**
   * MIDI note for a degree, where degree 0 is the root in `baseOctave`
   * (root placed at MIDI (baseOctave + 1) * 12 + root).
   */
  degreeToMidi(degree: number, baseOctave: number): MidiNote {
    const octaveShift = Math.floor(degree / this.size);
    const interval = this.intervals[mod(degree, this.size)]!;
    return (baseOctave + 1) * 12 + this.root + octaveShift * 12 + interval;
  }

  /** Inverse of degreeToMidi for in-scale notes; quantizes others first. */
  midiToDegree(note: MidiNote, baseOctave: number): number {
    const q = this.quantize(note);
    const rootMidi = (baseOctave + 1) * 12 + this.root;
    const rel = q - rootMidi;
    const octaveShift = Math.floor(rel / 12);
    const idx = this.intervals.indexOf(mod(rel, 12));
    return octaveShift * this.size + idx;
  }

  /** Snap a note to the nearest scale tone (ties resolve downwards). */
  quantize(note: MidiNote): MidiNote {
    for (let d = 0; d <= 6; d++) {
      if (this.contains(note - d)) return note - d;
      if (this.contains(note + d)) return note + d;
    }
    return note;
  }

  /** All scale tones in [low, high], inclusive. */
  notesInRange(low: MidiNote, high: MidiNote): MidiNote[] {
    const out: MidiNote[] = [];
    for (let n = low; n <= high; n++) if (this.contains(n)) out.push(n);
    return out;
  }
}
