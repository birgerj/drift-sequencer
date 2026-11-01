import type { Pattern, PatternEvent } from '../pattern/pattern';
import type { Scale } from '../theory/scale';
import { TR8S_NOTES } from '../generators/drumGenerator';

/**
 * Converting MusicVAE "trio" output (melody + bass + drums, 4 bars of 16ths)
 * into Drift patterns, and the latent-space math used to move between them.
 * Pure functions: the model itself runs in a worker (see io/ensemble).
 */

/** One note of a decoded trio, as plain data (posted from the worker). */
export interface TrioNote {
  pitch: number;
  start: number;
  end: number;
  /** 0 = melody, 1 = bass, 2 = drums */
  instrument: number;
  isDrum: boolean;
}

/** The trio model writes 4 bars of 16th notes. */
export const TRIO_BARS = 4;
export const TRIO_STEPS_PER_BAR = 16;
export const TRIO_STEPS = TRIO_BARS * TRIO_STEPS_PER_BAR;

/** The model's 9 drum classes (first pitch of each class) → TR-8S voice. */
const DRUM_CLASS_VOICE: Record<number, keyof typeof TR8S_NOTES> = {
  36: 'BD',
  38: 'SD',
  42: 'CH',
  46: 'OH',
  45: 'LT',
  48: 'MT',
  50: 'HT',
  49: 'CC',
  51: 'RC',
};

const DRUM_VELOCITY: Partial<Record<keyof typeof TR8S_NOTES, number>> = { BD: 112, SD: 100, CH: 78, OH: 86 };

export interface TrioOptions {
  scale: Scale;
  /** Voice name → MIDI note of the drum track (falls back to the TR-8S map). */
  drumNotes?: Record<string, number>;
  melodyVelocity?: number;
  bassVelocity?: number;
}

export interface TrioPatterns {
  melody: Pattern;
  bass: Pattern;
  drums: Pattern;
}

/**
 * Turn a decoded trio into three patterns:
 * - the trio is transposed so most of its notes fall in Drift's key,
 * - melody and bass become key degrees, so each line keeps the shape the
 *   model wrote (out-of-key notes snap to the nearest degree),
 * - only the strong points are bent onto Drift's chords: the bass plays the
 *   chord root on each bar's downbeat and a chord tone halfway, the melody a
 *   chord tone on the downbeat and halfway,
 * - lines resolve to the nearest octave, so the register fold never makes
 *   them jump.
 */
export function trioToPatterns(notes: readonly TrioNote[], opts: TrioOptions): TrioPatterns {
  const { scale } = opts;
  const melodic = notes.filter((n) => !n.isDrum && n.instrument !== 2);
  const shift = bestTransposition(melodic, scale);
  const part = (instrument: number, velocity: number, bass: boolean): Pattern => {
    const own = melodic.filter((n) => n.instrument === instrument).sort((a, b) => a.start - b.start);
    const degrees = own.map((n) => degreeOf(n.pitch + shift, scale));
    // Centre the part on the track's base octave: its median lands within ±half an octave of the root.
    const sorted = [...degrees].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const offset = Math.round(median / scale.size) * scale.size;
    const events = own.map((n, i): PatternEvent => {
      const step = clampStep(n.start);
      const downbeat = step % TRIO_STEPS_PER_BAR === 0;
      const half = step % (TRIO_STEPS_PER_BAR / 2) === 0;
      const fit = downbeat && bass ? 'root' : half ? 'tone' : undefined;
      return {
        step,
        length: Math.max(1, Math.min(TRIO_STEPS - step, n.end - n.start)),
        velocity: half ? Math.min(127, velocity + 8) : velocity,
        pitch: { kind: 'keyDegree', degree: degrees[i]! - offset, nearest: true, ...(fit ? { fit } : {}) },
      };
    });
    return { lengthSteps: TRIO_STEPS, events: dedupe(events) };
  };

  const drumEvents = notes
    .filter((n) => n.isDrum || n.instrument === 2)
    .flatMap((n): PatternEvent[] => {
      const voice = DRUM_CLASS_VOICE[n.pitch];
      if (!voice) return [];
      return [
        {
          step: clampStep(n.start),
          length: 0.5,
          velocity: DRUM_VELOCITY[voice] ?? 92,
          pitch: { kind: 'fixed', note: opts.drumNotes?.[voice] ?? TR8S_NOTES[voice] },
        },
      ];
    });

  return {
    melody: part(0, opts.melodyVelocity ?? 96, false),
    bass: part(1, opts.bassVelocity ?? 100, true),
    drums: { lengthSteps: TRIO_STEPS, events: dedupe(drumEvents) },
  };
}

/**
 * How usable a decoded trio is, 0..1. Samples from a random point vary a lot:
 * some have no kick or snare, a melody of two notes or a bass that never
 * moves. Several candidates are decoded and the best one plays.
 */
export function scoreTrio(notes: readonly TrioNote[], parts: { melody: boolean; bass: boolean; drums: boolean } = { melody: true, bass: true, drums: true }): number {
  const scores: number[] = [];
  const line = (instrument: number) => notes.filter((n) => !n.isDrum && n.instrument === instrument).sort((a, b) => a.start - b.start);
  const lineScore = (ns: TrioNote[], minNotes: number, maxNotes: number, minDistinct: number, maxRange: number, minMoves: number) => {
    if (ns.length === 0) return 0;
    // A line that repeats one note for bars isn't a melody, however many notes it has.
    let moves = 0;
    for (let i = 1; i < ns.length; i++) if (ns[i]!.pitch !== ns[i - 1]!.pitch) moves++;
    const motion = Math.min(1, moves / Math.max(1, ns.length - 1) / minMoves);
    const pitches = ns.map((n) => n.pitch);
    const range = Math.max(...pitches) - Math.min(...pitches);
    const distinct = new Set(pitches.map((p) => p % 12)).size;
    const count = ns.length < minNotes ? ns.length / minNotes : ns.length > maxNotes ? maxNotes / ns.length : 1;
    const variety = Math.min(1, distinct / minDistinct);
    const span = range > maxRange ? maxRange / range : range < 3 ? 0.4 : 1;
    // Every bar should have something to play.
    const bars = new Set(ns.map((n) => Math.floor(n.start / TRIO_STEPS_PER_BAR))).size / TRIO_BARS;
    return count * variety * span * motion * (0.5 + 0.5 * bars);
  };
  if (parts.melody) scores.push(lineScore(line(0), 10, 40, 4, 14, 0.4));
  if (parts.bass) scores.push(lineScore(line(1), 6, 36, 3, 15, 0.2));
  if (parts.drums) {
    const drums = notes.filter((n) => n.isDrum || n.instrument === 2);
    const at = (pitch: number, step: number) => drums.some((n) => n.pitch === pitch && n.start === step);
    let kicks = 0;
    let backbeats = 0;
    for (let bar = 0; bar < TRIO_BARS; bar++) {
      const b = bar * TRIO_STEPS_PER_BAR;
      if (at(36, b)) kicks++;
      if (at(38, b + 4) || at(38, b + 12)) backbeats++;
    }
    const hats = drums.filter((n) => n.pitch === 42 || n.pitch === 46 || n.pitch === 51).length;
    const perBar = drums.length / TRIO_BARS;
    const groove = (kicks / TRIO_BARS) * (0.4 + 0.6 * (backbeats / TRIO_BARS));
    const pulse = hats >= 8 ? 1 : 0.6;
    const busy = perBar > 14 ? 14 / perBar : 1;
    scores.push(groove * pulse * busy);
  }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

/** Semitone shift (−5…+6) that puts the most note-time inside the scale. Ties: smallest shift. */
export function bestTransposition(notes: readonly TrioNote[], scale: Scale): number {
  if (notes.length === 0) return 0;
  const inKey = new Set(scale.pitchClasses());
  const tonic = scale.root;
  let best = 0;
  let bestScore = -Infinity;
  for (const shift of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
    let score = 0;
    for (const n of notes) {
      const pc = mod(n.pitch + shift, 12);
      const weight = Math.max(1, n.end - n.start);
      if (inKey.has(pc)) score += weight;
      // A part that starts or sits on the tonic sounds "in" the key.
      if (pc === tonic) score += weight * 0.25;
    }
    if (score > bestScore) {
      bestScore = score;
      best = shift;
    }
  }
  return best;
}

/** Scale degree of a MIDI note, counted from the root in octave 0; off-scale notes snap to the nearest degree. */
export function degreeOf(note: number, scale: Scale): number {
  const rel = note - scale.root;
  const octave = Math.floor(rel / 12);
  const within = rel - octave * 12;
  let best = 0;
  let bestDist = Infinity;
  for (let k = 0; k <= scale.size; k++) {
    // k = size is the root an octave up.
    const interval = k === scale.size ? 12 : scale.intervals[k]!;
    const d = Math.abs(interval - within);
    if (d < bestDist || (d === bestDist && interval > within)) {
      bestDist = d;
      best = k;
    }
  }
  return octave * scale.size + best;
}

/** In a 7-note scale, chord tones are degrees 0, 2 and 4 above the chord root. (Kept for chord-relative lines.) */
export function snapToChordTone(degree: number, size: number): number {
  if (size !== 7) return degree;
  const within = mod(degree, 7);
  if (within === 0 || within === 2 || within === 4) return degree;
  // 1 → 0 or 2 (down), 3 → 2 or 4 (down), 5 → 4, 6 → 7 (the root above).
  const target = within === 6 ? 7 : within - 1;
  return degree - within + target;
}

function clampStep(step: number): number {
  return Math.max(0, Math.min(TRIO_STEPS - 1, Math.round(step)));
}

function dedupe(events: PatternEvent[]): PatternEvent[] {
  const seen = new Set<string>();
  return events
    .filter((e) => {
      const key = `${e.step}:${e.pitch.kind === 'fixed' ? e.pitch.note : 'm'}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.step - b.step);
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

// ---------- latent space ----------

/** A random point in the model's latent space (standard normal). */
export function randomLatent(dims: number, random: () => number = Math.random): number[] {
  const z: number[] = [];
  while (z.length < dims) {
    // Box–Muller: two normals from two uniforms.
    const u = Math.max(1e-12, random());
    const v = random();
    const r = Math.sqrt(-2 * Math.log(u));
    z.push(r * Math.cos(2 * Math.PI * v));
    if (z.length < dims) z.push(r * Math.sin(2 * Math.PI * v));
  }
  return z;
}

/** Spherical interpolation: stays in the dense part of the latent space, so in-between points sound musical. */
export function slerp(a: readonly number[], b: readonly number[], t: number): number[] {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return a.map((x, i) => x + (b[i]! - x) * t);
  const dot = a.reduce((s, x, i) => s + (x / na) * (b[i]! / nb), 0);
  const omega = Math.acos(Math.max(-1, Math.min(1, dot)));
  if (omega < 1e-6) return a.map((x, i) => x + (b[i]! - x) * t);
  const sa = Math.sin((1 - t) * omega) / Math.sin(omega);
  const sb = Math.sin(t * omega) / Math.sin(omega);
  return a.map((x, i) => sa * x + sb * b[i]!);
}

/**
 * One evolution step: rotate a little towards a fresh random point. With
 * `amount` 1 that is about a quarter of the way; small amounts keep the
 * music recognisable from one change to the next.
 */
export function evolveLatent(z: readonly number[], amount: number, random: () => number = Math.random): number[] {
  const theta = (Math.max(0, Math.min(1, amount)) * Math.PI) / 8;
  const n = randomLatent(z.length, random);
  return z.map((x, i) => x * Math.cos(theta) + n[i]! * Math.sin(theta));
}

function norm(v: readonly number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}
