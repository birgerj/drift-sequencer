import { mod, NOTE_NAMES, pitchClassOf, type MidiNote, type PitchClass } from './note';
import type { Scale } from './scale';

export type ChordSize = 3 | 4 | 5;

const QUALITY_SUFFIX: Record<string, string> = {
  '0,4,7': '',
  '0,3,7': 'm',
  '0,3,6': 'dim',
  '0,4,8': 'aug',
  '0,2,7': 'sus2',
  '0,5,7': 'sus4',
  '0,4,7,11': 'maj7',
  '0,3,7,10': 'm7',
  '0,4,7,10': '7',
  '0,3,6,10': 'm7b5',
  '0,3,6,9': 'dim7',
  '0,3,7,11': 'mMaj7',
  '0,4,8,11': 'maj7#5',
  '0,2,4,7,11': 'maj9',
  '0,2,3,7,10': 'm9',
  '0,2,4,7,10': '9',
  '0,1,3,7,10': 'm7b9',
  '0,1,3,6,10': 'm7b5b9',
};

/**
 * A diatonic chord built by stacking thirds on a scale degree.
 * Tones are stored as pitch classes; voicing into MIDI happens separately.
 */
export class Chord {
  readonly tones: readonly PitchClass[];

  private constructor(
    readonly degree: number,
    readonly size: ChordSize,
    tones: PitchClass[],
  ) {
    this.tones = tones;
  }

  static fromDegree(scale: Scale, degree: number, size: ChordSize = 3): Chord {
    const tones: PitchClass[] = [];
    for (let i = 0; i < size; i++) tones.push(scale.pitchClassOfDegree(degree + i * 2));
    return new Chord(degree, size, tones);
  }

  get root(): PitchClass {
    return this.tones[0]!;
  }

  contains(note: MidiNote): boolean {
    return this.tones.includes(pitchClassOf(note));
  }

  /** Index of the note's pitch class in the chord, or -1. */
  toneIndex(note: MidiNote): number {
    return this.tones.indexOf(pitchClassOf(note));
  }

  symbol(): string {
    const key = this.tones
      .map((pc) => mod(pc - this.root, 12))
      .sort((a, b) => a - b)
      .join(',');
    const suffix = QUALITY_SUFFIX[key] ?? '?';
    return `${NOTE_NAMES[this.root]}${suffix}`;
  }

  /** Roman numeral for the chord's degree, case following the third. */
  roman(): string {
    const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
    const n = numerals[mod(this.degree, 7)] ?? '?';
    const third = this.tones[1] === undefined ? 4 : mod(this.tones[1] - this.root, 12);
    return third === 3 ? n.toLowerCase() : n;
  }

  /** Close-position voicing with the root at or above `low`. */
  closeVoicing(low: MidiNote): MidiNote[] {
    const out: MidiNote[] = [];
    let prev = low - 1;
    for (const pc of this.tones) {
      let n = prev + 1;
      while (pitchClassOf(n) !== pc) n++;
      out.push(n);
      prev = n;
    }
    return out;
  }
}

/**
 * Choose the voicing of `chord` within [low, high] that moves least from
 * `previous` (sum of absolute semitone distances between sorted voices).
 * Without a previous voicing, returns a close voicing centred in the range.
 */
export function voiceLead(
  chord: Chord,
  previous: readonly MidiNote[] | undefined,
  low: MidiNote,
  high: MidiNote,
): MidiNote[] {
  const candidates: MidiNote[][] = [];
  const n = chord.tones.length;
  for (let inv = 0; inv < n; inv++) {
    const rotated = [...chord.tones.slice(inv), ...chord.tones.slice(0, inv)];
    for (let start = low; start <= high; start++) {
      if (pitchClassOf(start) !== rotated[0]) continue;
      const voicing: MidiNote[] = [start];
      let prev = start;
      for (const pc of rotated.slice(1)) {
        let next = prev + 1;
        while (pitchClassOf(next) !== pc) next++;
        voicing.push(next);
        prev = next;
      }
      if (voicing[voicing.length - 1]! <= high) candidates.push(voicing);
    }
  }
  if (candidates.length === 0) return chord.closeVoicing(low);

  if (!previous || previous.length === 0) {
    const centre = (low + high) / 2;
    return minBy(candidates, (v) => Math.abs(avg(v) - centre));
  }
  const prevSorted = [...previous].sort((a, b) => a - b);
  return minBy(candidates, (v) => movement(prevSorted, v));
}

function movement(prev: readonly MidiNote[], next: readonly MidiNote[]): number {
  let cost = 0;
  const len = Math.max(prev.length, next.length);
  for (let i = 0; i < len; i++) {
    const a = prev[Math.min(i, prev.length - 1)]!;
    const b = next[Math.min(i, next.length - 1)]!;
    cost += Math.abs(a - b);
  }
  return cost;
}

function avg(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function minBy<T>(items: readonly T[], score: (t: T) => number): T {
  let best = items[0] as T;
  let bestScore = score(best);
  for (const item of items.slice(1)) {
    const s = score(item);
    if (s < bestScore) {
      best = item;
      bestScore = s;
    }
  }
  return best;
}
