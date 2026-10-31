import type { Rng } from '../random/rng';
import { Chord, type ChordSize } from './chord';
import type { ProgressionStep } from './harmony';
import type { Scale } from './scale';

export type ProgressionStyle = 'pop' | 'house' | 'techno' | 'ambient' | 'cinematic' | 'jazzy';

export const PROGRESSION_STYLES: { id: ProgressionStyle; label: string }[] = [
  { id: 'pop', label: 'Pop' },
  { id: 'house', label: 'House' },
  { id: 'techno', label: 'Techno' },
  { id: 'ambient', label: 'Ambient' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'jazzy', label: 'Jazzy' },
];

/**
 * Functional-harmony transition weights between scale degrees (0 = tonic).
 * Rows: from-degree; columns: to-degree. Works for any 7-note mode because
 * it is expressed in degrees; diminished chords are filtered separately.
 */
const BASE: number[][] = [
  //  I    ii   iii  IV   V    vi   vii
  [0.0, 1.0, 0.6, 1.6, 1.6, 1.4, 0.4], // from I
  [0.4, 0.0, 0.3, 0.6, 2.0, 0.5, 0.6], // from ii
  [0.4, 0.3, 0.0, 1.2, 0.4, 1.6, 0.2], // from iii
  [1.2, 0.8, 0.3, 0.0, 1.8, 0.6, 0.4], // from IV
  [2.0, 0.3, 0.4, 0.8, 0.0, 1.4, 0.3], // from V
  [0.6, 1.2, 0.5, 1.6, 1.0, 0.0, 0.3], // from vi
  [1.8, 0.2, 0.8, 0.4, 0.4, 0.6, 0.0], // from vii
];

interface StyleSpec {
  /** Multiplier per target degree — the "colour" of the style. */
  bias: number[];
  sizes: { size: ChordSize; weight: number }[];
  barsPerChord: number[];
  lengths: number[];
  allowDiminished: boolean;
}

const STYLES: Record<ProgressionStyle, StyleSpec> = {
  pop: { bias: [1.4, 0.6, 0.5, 1.4, 1.5, 1.4, 0.4], sizes: [{ size: 3, weight: 1 }], barsPerChord: [1, 2], lengths: [4], allowDiminished: false },
  house: {
    bias: [1, 1.5, 0.6, 1.2, 1.2, 1.3, 0.5],
    sizes: [
      { size: 4, weight: 2 },
      { size: 5, weight: 1 },
    ],
    barsPerChord: [2],
    lengths: [4],
    allowDiminished: false,
  },
  techno: {
    bias: [2.2, 0.8, 0.5, 0.9, 0.6, 1.2, 1.6],
    sizes: [{ size: 3, weight: 1 }],
    barsPerChord: [2, 4],
    lengths: [2, 4],
    allowDiminished: false,
  },
  ambient: {
    bias: [1.2, 1.1, 1.0, 1.6, 0.6, 1.3, 0.3],
    sizes: [
      { size: 4, weight: 2 },
      { size: 5, weight: 1 },
    ],
    barsPerChord: [4],
    lengths: [3, 4],
    allowDiminished: false,
  },
  cinematic: { bias: [1.3, 0.5, 1.4, 1.0, 0.8, 1.6, 1.4], sizes: [{ size: 3, weight: 1 }], barsPerChord: [2], lengths: [4, 8], allowDiminished: false },
  jazzy: {
    bias: [1, 1.8, 1, 1, 1.8, 1.2, 0.8],
    sizes: [
      { size: 4, weight: 3 },
      { size: 5, weight: 1 },
    ],
    barsPerChord: [1, 2],
    lengths: [4, 8],
    allowDiminished: true,
  },
};

function isDiminished(scale: Scale, degree: number): boolean {
  return /dim|m7b5/.test(Chord.fromDegree(scale, degree, 3).symbol());
}

function targetWeights(scale: Scale, from: number, spec: StyleSpec): number[] {
  const row = BASE[((from % 7) + 7) % 7]!;
  return row.map((w, to) => {
    let weight = w * spec.bias[to]!;
    if (!spec.allowDiminished && isDiminished(scale, to)) weight = 0;
    return weight;
  });
}

function pickSize(spec: StyleSpec, rng: Rng): ChordSize {
  return rng.weighted(
    spec.sizes.map((s) => s.size),
    spec.sizes.map((s) => s.weight),
  );
}

/** A fresh progression: starts on the tonic, flows by functional harmony, ends pulling home. */
export function generateProgression(scale: Scale, style: ProgressionStyle, rng: Rng, length?: number): ProgressionStep[] {
  const spec = STYLES[style];
  const degreesInScale = Math.min(7, scale.size);
  const count = length ?? rng.pick(spec.lengths);
  const bars = rng.pick(spec.barsPerChord);
  const degrees: number[] = [0];
  const all = Array.from({ length: degreesInScale }, (_, i) => i);
  while (degrees.length < count) {
    const prev = degrees[degrees.length - 1]!;
    const weights = targetWeights(scale, prev, spec).slice(0, degreesInScale);
    // The last chord should lead back to the tonic.
    if (degrees.length === count - 1) {
      const home = BASE.map((row) => row[0]!);
      for (let i = 0; i < weights.length; i++) weights[i] = weights[i]! * (0.3 + home[i]!) * (i === 0 ? 0 : 1);
    }
    degrees.push(rng.weighted(all, weights));
  }
  return degrees.map((degree) => ({ degree, bars, size: pickSize(spec, rng) }));
}

/** Functional substitutes: chords that can stand in for each other. */
const SUBSTITUTES: Record<number, number[]> = {
  0: [5, 2],
  1: [3, 6],
  2: [0, 5],
  3: [1, 5],
  4: [6, 2],
  5: [0, 3],
  6: [4, 2],
};

/**
 * Change one chord (never the first) to a substitute that still flows from
 * its neighbour, so the progression evolves without losing its character.
 */
export function varyProgression(progression: readonly ProgressionStep[], scale: Scale, style: ProgressionStyle, rng: Rng): ProgressionStep[] {
  if (progression.length < 2) return generateProgression(scale, style, rng);
  const spec = STYLES[style];
  const next = progression.map((s) => ({ ...s }));
  const i = rng.int(1, next.length - 1);
  const current = next[i]!.degree;
  const prev = next[i - 1]!.degree;
  const flow = targetWeights(scale, prev, spec);
  const options = (SUBSTITUTES[((current % 7) + 7) % 7] ?? []).filter(
    (d) => d < scale.size && d !== prev && d !== next[i + 1]?.degree && (spec.allowDiminished || !isDiminished(scale, d)),
  );
  if (options.length > 0) {
    next[i]!.degree = rng.weighted(options, options.map((d) => 0.2 + (flow[d] ?? 0)));
  }
  if (rng.chance(0.3)) next[i]!.size = pickSize(spec, rng);
  return next;
}
