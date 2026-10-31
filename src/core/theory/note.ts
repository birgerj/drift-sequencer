/** Pitch class 0..11 where C = 0. */
export type PitchClass = number;
/** MIDI note number 0..127 where C4 = 60. */
export type MidiNote = number;

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const NAME_TO_PC: Record<string, PitchClass> = {
  C: 0, 'B#': 0,
  'C#': 1, Db: 1,
  D: 2,
  'D#': 3, Eb: 3,
  E: 4, Fb: 4,
  F: 5, 'E#': 5,
  'F#': 6, Gb: 6,
  G: 7,
  'G#': 8, Ab: 8,
  A: 9,
  'A#': 10, Bb: 10,
  B: 11, Cb: 11,
};

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function pitchClassOf(note: MidiNote): PitchClass {
  return mod(note, 12);
}

export function octaveOf(note: MidiNote): number {
  return Math.floor(note / 12) - 1;
}

/** "A3" style name; uses sharps. */
export function noteName(note: MidiNote): string {
  return `${NOTE_NAMES[pitchClassOf(note)]}${octaveOf(note)}`;
}

export function parsePitchClass(name: string): PitchClass {
  const pc = NAME_TO_PC[name.trim()];
  if (pc === undefined) throw new Error(`Unknown note name: ${name}`);
  return pc;
}

/** MIDI note for a pitch class in a given octave (C4 = 60). */
export function midiOf(pc: PitchClass, octave: number): MidiNote {
  return (octave + 1) * 12 + mod(pc, 12);
}

export function clampMidi(note: MidiNote): MidiNote {
  return Math.max(0, Math.min(127, Math.round(note)));
}
