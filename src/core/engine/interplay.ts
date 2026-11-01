import type { Chord } from '../theory/chord';
import { pitchClassOf, type MidiNote } from '../theory/note';
import type { Rng } from '../random/rng';
import type { ScheduledNote } from './trackRuntime';

/**
 * How a track reacts to the notes other tracks play on the same step.
 * Applied at play time, like the kick awareness, so it always reflects what
 * the other tracks play right now — also after they mutate.
 */
export interface InterplaySettings {
  /** Track ids this track listens to. */
  listenTo: string[];
  /**
   * free: rhythm is not affected · space: rest where they play ·
   * lock: play where they play, rest in between.
   */
  rhythm: 'free' | 'space' | 'lock';
  /** On strong steps, move away from a pitch class they already play. */
  otherTone: boolean;
  /** 0..1 — how strictly the rules apply. */
  amount: number;
}

export const DEFAULT_INTERPLAY: InterplaySettings = { listenTo: [], rhythm: 'space', otherTone: true, amount: 0.7 };

export function interplayActive(s: InterplaySettings | undefined): s is InterplaySettings {
  return !!s && s.listenTo.length > 0 && s.amount > 0 && (s.rhythm !== 'free' || s.otherTone);
}

/**
 * Apply one track's interplay rules for a global step.
 *
 * @param own      this track's notes for the step
 * @param heard    the notes of the tracks it listens to (before their own interplay)
 * @param strong   whether the step is on a beat
 * @param fixed    this track plays fixed notes (drums): pitch rules don't apply
 */
export function applyInterplay(
  own: ScheduledNote[],
  heard: ScheduledNote[],
  settings: InterplaySettings,
  ctx: { strong: boolean; chord: Chord; rng: Rng; fixed: boolean; low: MidiNote; high: MidiNote },
): ScheduledNote[] {
  if (own.length === 0) return own;
  const amount = Math.max(0, Math.min(1, settings.amount));
  // Only onsets at the start of the step count; ×2 tracks' in-between notes don't.
  const theyPlay = heard.some((n) => n.offset === 0);
  let out = own;

  if (settings.rhythm === 'space' && theyPlay) {
    out = out.filter((n) => n.offset !== 0 || !ctx.rng.chance(amount));
  } else if (settings.rhythm === 'lock') {
    if (theyPlay) {
      // Together: a little push, so the hits read as one.
      out = out.map((n) => (n.offset === 0 && !n.accent ? { ...n, velocity: Math.min(127, n.velocity + Math.round(12 * amount)) } : n));
    } else {
      out = out.filter((n) => n.offset !== 0 || !ctx.rng.chance(amount));
    }
  }

  if (settings.otherTone && !ctx.fixed && ctx.strong && out.length) {
    const taken = new Set<number>();
    for (const n of heard) if (n.offset === 0) for (const note of n.notes) taken.add(pitchClassOf(note));
    if (taken.size) out = out.map((n) => (n.offset === 0 && ctx.rng.chance(amount) ? avoidPitchClasses(n, taken, ctx.chord, ctx.low, ctx.high) : n));
  }
  return out;
}

/**
 * A single note on a taken pitch class moves to the nearest chord tone that
 * is still free. A chord drops the doubled tones, as long as two remain.
 */
export function avoidPitchClasses(n: ScheduledNote, taken: Set<number>, chord: Chord, low: MidiNote, high: MidiNote): ScheduledNote {
  if (n.notes.length > 1) {
    const kept = n.notes.filter((x) => !taken.has(pitchClassOf(x)));
    return kept.length >= 2 && kept.length < n.notes.length ? { ...n, notes: kept } : n;
  }
  const note = n.notes[0];
  if (note === undefined || !taken.has(pitchClassOf(note))) return n;
  const free = chord.tones.filter((pc) => !taken.has(pc));
  if (free.length === 0) return n;
  let best: MidiNote | undefined;
  for (let d = 1; d <= 12 && best === undefined; d++) {
    // Prefer moving up: a third or fifth above sounds like harmony, not a dodge.
    for (const cand of [note + d, note - d]) {
      if (cand < low || cand > high || cand < 0 || cand > 127) continue;
      if (free.includes(pitchClassOf(cand))) {
        best = cand;
        break;
      }
    }
  }
  return best === undefined ? n : { ...n, notes: [best] };
}
