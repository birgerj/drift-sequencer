import type { Pattern, PatternEvent } from '../pattern/pattern';
import type { Rng } from '../random/rng';
import { humanizeVelocity } from './types';

/**
 * Phrase-based melody writing.
 *
 * Instead of a random walk, a melody is built the way songwriters do it:
 *  - Form: the pattern is split into phrases (usually one bar each) that
 *    follow a song-like plan — A, A' (varied repeat), B (contrast), A''
 *    (repeat with a closing cadence). Repetition is what makes a line
 *    memorable.
 *  - Rhythm: each phrase gets a rhythm made of beat-sized cells, so the
 *    rhythm has a recognisable motif instead of random onsets.
 *  - Pitch: chord tones on strong beats; on weak beats passing and neighbour
 *    tones that move by step and resolve by step; leaps are followed by a
 *    step back the other way (gap fill); the line follows a contour (arch,
 *    rise, fall) with one climax.
 *  - Cadences: phrases end on stable tones; the last phrase lands on the
 *    chord root with a longer note.
 *
 * Several candidates are written and scored on these rules; the best wins.
 *
 * Pitches are degrees relative to the current chord's root, so every chord
 * tone stays a chord tone under whatever chord is playing.
 */

export interface PhraseParams {
  lengthSteps: number;
  density: number;
  rangeDegrees: number;
  maxLeap: number;
  chordToneBias: number;
  rhythmLock: boolean;
  mutation: number;
  velocity: number;
  velocityVariation: number;
}

type Role = 'A' | 'A2' | 'B' | 'A3';
type Contour = 'arch' | 'rise' | 'fall' | 'valley';

/** Onsets within a 4-step beat (scaled for other beat sizes). */
const BEAT_CELLS: readonly (readonly number[])[] = [
  [0],
  [0, 2],
  [0, 3],
  [0, 2, 3],
  [0, 1, 2],
  [0, 1, 2, 3],
  [2],
  [0, 1],
  [3],
  [],
];

const CANDIDATES = 12;

export function isChordTone(degree: number): boolean {
  const d = ((degree % 7) + 7) % 7;
  return d === 0 || d === 2 || d === 4;
}

function isRoot(degree: number): boolean {
  return ((degree % 7) + 7) % 7 === 0;
}

export function generatePhraseMelody(params: PhraseParams, rng: Rng, stepsPerBar: number): Pattern {
  let best: Pattern | undefined;
  let bestScore = -Infinity;
  for (let i = 0; i < CANDIDATES; i++) {
    const candidate = writeMelody(params, rng, stepsPerBar);
    const score = scoreMelody(candidate, params, stepsPerBar) + rng.next() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best!;
}

// ---------------------------------------------------------------- form

interface Segment {
  start: number;
  length: number;
  role: Role;
  final: boolean;
}

function planSegments(lengthSteps: number, stepsPerBar: number): Segment[] {
  const beat = Math.max(1, Math.round(stepsPerBar / 4));
  let segLen = stepsPerBar;
  if (lengthSteps < stepsPerBar * 2) segLen = Math.max(beat, Math.floor(lengthSteps / 2 / beat) * beat);
  const count = Math.max(1, Math.floor(lengthSteps / segLen));
  const roles: Role[] = ['A', 'A2', 'B', 'A3'];
  const segments: Segment[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * segLen;
    const last = i === count - 1;
    segments.push({
      start,
      length: last ? lengthSteps - start : segLen,
      role: count === 1 ? 'A3' : count === 2 ? (i === 0 ? 'A' : 'A3') : count === 3 ? (['A', 'A2', 'A3'] as Role[])[i]! : roles[i % 4]!,
      final: last,
    });
  }
  return segments;
}

// ---------------------------------------------------------------- rhythm

function rhythmFor(length: number, beat: number, density: number, rng: Rng, closing: boolean): number[] {
  const target = Math.max(0.6, Math.min(4, density * 4.4));
  const onsets: number[] = [];
  const beats = Math.max(1, Math.ceil(length / beat));
  for (let b = 0; b < beats; b++) {
    const weights = BEAT_CELLS.map((cell) => {
      const n = cell.length;
      let w = Math.exp(-((n - target) ** 2) / 1.4);
      if (n === 0) w *= 0.35;
      if (b === 0 && cell[0] !== 0) w *= 0.02; // phrases start on the downbeat
      if (cell.length === 1 && cell[0] === 3) w *= 0.5; // anticipation, use sparingly
      return w;
    });
    let cell = rng.weighted(BEAT_CELLS, weights);
    if (closing && b === beats - 1) cell = [0]; // a held note closes the phrase
    for (const o of cell) {
      const step = b * beat + Math.min(beat - 1, Math.round((o * beat) / 4));
      if (step < length && !onsets.includes(step)) onsets.push(step);
    }
  }
  if (!onsets.includes(0)) onsets.unshift(0);
  return onsets.sort((a, b) => a - b);
}

// ---------------------------------------------------------------- pitch

function contourTarget(contour: Contour, t: number, lo: number, hi: number, lift: number): number {
  const span = hi - lo;
  let shape: number;
  switch (contour) {
    case 'arch':
      shape = 0.3 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.1));
      break;
    case 'rise':
      shape = 0.25 + 0.6 * t;
      break;
    case 'fall':
      shape = 0.85 - 0.6 * t;
      break;
    case 'valley':
      shape = 0.7 - 0.45 * Math.sin(Math.PI * t);
      break;
  }
  return Math.max(lo, Math.min(hi, lo + span * shape + lift));
}

interface PitchContext {
  prev?: number;
  prevPrev?: number;
  strong: boolean;
  downbeat: boolean;
  target: number;
  /** Allowed end tones, when this note closes a phrase. */
  endOn?: (d: number) => boolean;
  /** The next note is fixed (e.g. re-pitching inside a phrase). */
  next?: number;
}

export function choosePitch(ctx: PitchContext, params: PhraseParams, rng: Rng): number {
  const lo = 0;
  const hi = Math.max(3, params.rangeDegrees);
  const maxLeap = Math.max(1, params.maxLeap);
  const candidates: number[] = [];
  const weights: number[] = [];
  for (let d = lo; d <= hi; d++) {
    let w = 1;
    const chordTone = isChordTone(d);
    if (ctx.prev !== undefined) {
      const interval = d - ctx.prev;
      const size = Math.abs(interval);
      if (size > maxLeap) {
        // A cadence may stretch a little to reach its goal tone.
        if (!(ctx.endOn && ctx.endOn(d) && size <= maxLeap + 3)) continue;
        w *= 0.2;
      }
      w *= size === 0 ? 0.18 : size === 1 ? 1 : size === 2 ? 0.7 : size === 3 ? 0.35 : size === 4 ? 0.25 : 0.12;
      const prevInterval = ctx.prevPrev !== undefined ? ctx.prev - ctx.prevPrev : 0;
      // Gap fill: after a leap, step back the other way.
      if (Math.abs(prevInterval) >= 3) w *= Math.sign(interval) === -Math.sign(prevInterval) && size <= 2 ? 3 : 0.25;
      // A non-chord tone resolves by step.
      if (!isChordTone(ctx.prev) && size !== 1) w *= 0.05;
      // Not three of the same note in a row.
      if (size === 0 && ctx.prevPrev === ctx.prev) w *= 0.1;
      // Non-chord tones only by step (passing / neighbour tones).
      if (!chordTone && size !== 1) w *= 0.1;
    }
    if (ctx.next !== undefined) {
      const out = Math.abs(ctx.next - d);
      if (out > maxLeap) w *= 0.05;
      if (!chordTone && out !== 1) w *= 0.05;
    }
    if (ctx.strong) w *= chordTone ? 1 : Math.max(0.02, (1 - params.chordToneBias) * 0.4);
    if (ctx.downbeat && params.chordToneBias >= 0.5 && !chordTone) w *= 0.02;
    if (ctx.endOn && !ctx.endOn(d)) continue;
    w *= Math.exp(-((d - ctx.target) ** 2) / (2 * 1.6 ** 2));
    candidates.push(d);
    weights.push(w);
  }
  if (candidates.length === 0) return Math.max(lo, Math.min(hi, ctx.prev ?? 0));
  return rng.weighted(candidates, weights);
}

interface Note {
  step: number;
  degree: number;
}

function pitchLine(
  onsets: number[],
  seg: Segment,
  beat: number,
  params: PhraseParams,
  rng: Rng,
  contour: Contour,
  lift: number,
  start: { prev?: number; prevPrev?: number },
  endOn: ((d: number) => boolean) | undefined,
  keep: number[] = [],
): number[] {
  const hi = Math.max(3, params.rangeDegrees);
  const out: number[] = [];
  let { prev, prevPrev } = start;
  for (let i = 0; i < onsets.length; i++) {
    let degree: number;
    if (i < keep.length) {
      degree = keep[i]!;
    } else {
      const local = onsets[i]!;
      const last = i === onsets.length - 1;
      degree = choosePitch(
        {
          prev,
          prevPrev,
          strong: local % beat === 0,
          downbeat: local === 0,
          target: contourTarget(contour, onsets.length > 1 ? i / (onsets.length - 1) : 0, 0, hi, lift),
          endOn: last ? endOn : undefined,
        },
        params,
        rng,
      );
    }
    out.push(degree);
    prevPrev = prev;
    prev = degree;
  }
  return out;
}

function writeMelody(params: PhraseParams, rng: Rng, stepsPerBar: number): Pattern {
  const beat = Math.max(1, Math.round(stepsPerBar / 4));
  const hi = Math.max(3, params.rangeDegrees);
  const segments = planSegments(params.lengthSteps, stepsPerBar);
  const contours: Contour[] = ['arch', 'rise', 'fall', 'valley'];
  const contourA = rng.weighted(contours, [3, 2, 1.5, 1]);
  const contourB = rng.pick(contours.filter((c) => c !== contourA));

  const open = (d: number) => isChordTone(d) && !isRoot(d); // third or fifth: "question"
  const close = (d: number) => isRoot(d); // root: "answer"

  let rhythmA: number[] | undefined;
  let pitchesA: number[] | undefined;
  const notes: Note[] = [];
  for (const seg of segments) {
    const prev = notes[notes.length - 1]?.degree;
    const prevPrev = notes[notes.length - 2]?.degree;
    const endOn = seg.final ? close : open;
    let onsets: number[];
    let degrees: number[];
    if (seg.role === 'A' || !rhythmA || !pitchesA) {
      onsets = rhythmFor(seg.length, beat, params.density, rng, seg.final);
      degrees = pitchLine(onsets, seg, beat, params, rng, contourA, 0, { prev, prevPrev }, endOn);
      if (seg.role === 'A' || !rhythmA) {
        rhythmA = onsets;
        pitchesA = degrees;
      }
    } else if (seg.role === 'B') {
      onsets = rhythmFor(seg.length, beat, params.density * 1.1, rng, false);
      degrees = pitchLine(onsets, seg, beat, params, rng, contourB, Math.min(2, hi * 0.2), { prev, prevPrev }, (d) => isChordTone(d));
    } else {
      // A2 / A3: same rhythm and opening as A, a new ending.
      onsets = rhythmA.filter((o) => o < seg.length);
      if (seg.final && onsets.length > 1) {
        // Close with a held note in the last beat.
        const lastBeat = Math.floor((seg.length - 1) / beat) * beat;
        onsets = onsets.filter((o) => o < lastBeat);
        onsets.push(lastBeat);
      }
      const keepCount = Math.max(1, Math.ceil(onsets.length / 2));
      degrees = pitchLine(onsets, seg, beat, params, rng, contourA, 0, { prev, prevPrev }, endOn, pitchesA.slice(0, keepCount));
    }
    onsets.forEach((o, i) => notes.push({ step: seg.start + o, degree: degrees[i]! }));
  }

  const events: PatternEvent[] = notes.map((n, i) => {
    const next = notes[i + 1]?.step ?? params.lengthSteps;
    const gap = next - n.step;
    const strong = n.step % beat === 0;
    const bar = n.step % stepsPerBar === 0;
    // Mostly legato; short notes in fast runs stay detached a little.
    const length = gap <= 1 ? 1 : Math.min(gap, beat * 3) * (rng.chance(0.25) ? 0.75 : 1);
    return {
      step: n.step,
      length,
      velocity: humanizeVelocity(params.velocity, params.velocityVariation, rng, bar ? 12 : strong ? 6 : -4),
      pitch: { kind: 'degree', degree: n.degree, nearest: true },
    };
  });
  return { lengthSteps: params.lengthSteps, events };
}

// ---------------------------------------------------------------- scoring

function degreesOf(pattern: Pattern): number[] {
  return pattern.events.map((e) => (e.pitch.kind === 'degree' ? e.pitch.degree : 0));
}

/** Higher is more melodic. Exported for tests. */
export function scoreMelody(pattern: Pattern, params: PhraseParams, stepsPerBar: number): number {
  const beat = Math.max(1, Math.round(stepsPerBar / 4));
  const d = degreesOf(pattern);
  if (d.length < 2) return -5;
  let score = 0;
  let steps = 0;
  let unresolvedLeaps = 0;
  let repeats = 0;
  for (let i = 1; i < d.length; i++) {
    const iv = d[i]! - d[i - 1]!;
    if (Math.abs(iv) <= 2 && iv !== 0) steps++;
    if (iv === 0) repeats++;
    if (Math.abs(iv) >= 3 && i + 1 < d.length) {
      const back = d[i + 1]! - d[i]!;
      if (!(Math.sign(back) === -Math.sign(iv) && Math.abs(back) <= 2)) unresolvedLeaps++;
    }
  }
  const moves = d.length - 1;
  score += 4 * (1 - Math.abs(steps / moves - 0.7)); // mostly stepwise, some leaps
  score -= 2.5 * (unresolvedLeaps / moves);
  score -= 2 * Math.max(0, repeats / moves - 0.2);
  const strong = pattern.events.filter((e) => e.step % beat === 0);
  const strongOff = strong.filter((e) => e.pitch.kind === 'degree' && !isChordTone(e.pitch.degree)).length;
  score -= 3 * params.chordToneBias * (strong.length ? strongOff / strong.length : 0);
  const max = Math.max(...d);
  const min = Math.min(...d);
  const span = max - min;
  score -= span < 3 ? 2 : span > params.rangeDegrees + 1 ? 1 : 0;
  // One clear climax reads better than a ceiling hit over and over.
  const peaks = d.filter((x) => x === max).length;
  score -= peaks > 2 ? 0.4 * (peaks - 2) : 0;
  // A line that comes home.
  if (isRoot(d[d.length - 1]!)) score += 1;
  return score;
}

// ---------------------------------------------------------------- mutation

/**
 * Evolve a phrase melody without breaking it: re-pitch a few notes within the
 * rules (respecting both neighbours) and copy each change to the phrases that
 * repeat it, so the form survives. Without rhythm lock, a note is
 * occasionally split (adding a passing/neighbour tone) or a weak note dropped.
 */
export function mutatePhraseMelody(pattern: Pattern, params: PhraseParams, rng: Rng, stepsPerBar: number): Pattern {
  const beat = Math.max(1, Math.round(stepsPerBar / 4));
  const events = pattern.events.map((e) => ({ ...e, pitch: { ...e.pitch } }));
  const segLen = pattern.lengthSteps >= stepsPerBar * 2 ? stepsPerBar : Math.max(beat, Math.floor(pattern.lengthSteps / 2 / beat) * beat);
  const lastStep = events[events.length - 1]?.step;
  const deg = (e: PatternEvent | undefined) => (e && e.pitch.kind === 'degree' ? e.pitch.degree : undefined);

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.pitch.kind !== 'degree' || e.step === lastStep || !rng.chance(params.mutation)) continue;
    const old = e.pitch.degree;
    const local = e.step % segLen;
    const degree = choosePitch(
      {
        prev: deg(events[i - 1]),
        prevPrev: deg(events[i - 2]),
        next: deg(events[i + 1]),
        strong: local % beat === 0,
        downbeat: local === 0,
        target: old,
      },
      params,
      rng,
    );
    if (degree === old) continue;
    // Apply to every phrase that has the same note at the same spot.
    for (const other of events) {
      if (other.step % segLen === local && deg(other) === old && other.step !== lastStep) {
        other.pitch = { ...other.pitch, kind: 'degree', degree } as PatternEvent['pitch'];
      }
    }
  }

  if (params.rhythmLock) return { lengthSteps: pattern.lengthSteps, events };

  // Ornament: split a long note with a step towards the next one.
  if (rng.chance(params.mutation)) {
    const long = events.filter((e, i) => e.length >= 2 && i < events.length - 1 && e.step !== lastStep);
    if (long.length) {
      const e = rng.pick(long);
      const i = events.indexOf(e);
      const half = Math.max(1, Math.floor(e.length / 2));
      const from = deg(e) ?? 0;
      const to = deg(events[i + 1]) ?? from;
      const degree = to > from ? from + 1 : to < from ? from - 1 : from + (rng.chance(0.5) ? 1 : -1);
      e.length = half;
      events.splice(i + 1, 0, {
        step: e.step + half,
        length: half,
        velocity: Math.max(1, e.velocity - 10),
        pitch: { kind: 'degree', degree: Math.max(0, degree), nearest: true },
      });
    }
  }
  // Simplify: drop a weak-position note now and then.
  if (rng.chance(params.mutation * 0.5)) {
    const weak = events.filter((e) => e.step % beat !== 0 && e.step !== lastStep);
    if (weak.length) {
      const e = rng.pick(weak);
      const i = events.indexOf(e);
      const prev = events[i - 1];
      if (prev) prev.length += e.length;
      events.splice(i, 1);
    }
  }
  return { lengthSteps: pattern.lengthSteps, events };
}
