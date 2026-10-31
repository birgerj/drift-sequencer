import type { Pattern, PatternEvent } from '../pattern/pattern';
import type { Rng } from '../random/rng';
import {
  humanizeVelocity,
  isStrongStep,
  type CommonParams,
  type GeneratorContext,
  type PatternGenerator,
} from './types';

export interface MotifParams extends CommonParams {
  /** 0..1 chance a step starts a note (strong beats get a bonus). */
  density: number;
  /** Highest degree offset from the chord root, both directions. */
  rangeDegrees: number;
  /** Largest melodic leap in scale steps for the random walk. */
  maxLeap: number;
  /** 0..1 — how strongly strong beats are pulled to chord tones. */
  chordToneBias: number;
  /** Keep rhythm fixed during mutation; only pitches change. */
  rhythmLock: boolean;
}

/** Degree offsets (relative to the chord root) that are chord tones. */
const CHORD_TONE_DEGREES = [0, 2, 4];

export class MotifGenerator implements PatternGenerator<MotifParams> {
  readonly type = 'motif' as const;

  defaults(): MotifParams {
    return {
      lengthSteps: 32,
      density: 0.45,
      rangeDegrees: 7,
      maxLeap: 3,
      chordToneBias: 0.75,
      rhythmLock: false,
      mutation: 0.2,
      velocity: 96,
      velocityVariation: 0.3,
    };
  }

  generate(params: MotifParams, ctx: GeneratorContext): Pattern {
    const { rng, stepsPerBar } = ctx;
    const events: PatternEvent[] = [];
    let degree = 0;
    for (let step = 0; step < params.lengthSteps; step++) {
      const strong = isStrongStep(step, stepsPerBar);
      const p = Math.min(1, params.density + (strong ? 0.25 : 0));
      if (!rng.chance(p) && !(step === 0)) continue;
      degree = this.nextDegree(degree, strong, params, rng);
      events.push({
        step,
        length: rng.pick([1, 1, 2, 2, 3]),
        velocity: humanizeVelocity(params.velocity, params.velocityVariation, rng, strong ? 10 : 0),
        pitch: { kind: 'degree', degree },
      });
    }
    return { lengthSteps: params.lengthSteps, events: trimOverlaps(events, params.lengthSteps) };
  }

  mutate(pattern: Pattern, params: MotifParams, ctx: GeneratorContext): Pattern {
    const { rng, stepsPerBar } = ctx;
    const events = pattern.events.map((e) => ({ ...e }));
    for (const e of events) {
      if (!rng.chance(params.mutation) || e.pitch.kind !== 'degree') continue;
      const strong = isStrongStep(e.step, stepsPerBar);
      e.pitch = { kind: 'degree', degree: this.nextDegree(e.pitch.degree, strong, params, rng) };
    }
    if (!params.rhythmLock) {
      // Occasionally drop a note or fill an empty step.
      const drops = events.filter(() => rng.chance(params.mutation * 0.3));
      const kept = events.filter((e) => !drops.includes(e) || e.step === 0);
      const used = new Set(kept.map((e) => e.step));
      for (let step = 0; step < pattern.lengthSteps; step++) {
        if (used.has(step) || !rng.chance(params.mutation * params.density * 0.3)) continue;
        const prev = [...kept].reverse().find((e) => e.step < step);
        const prevDegree = prev?.pitch.kind === 'degree' ? prev.pitch.degree : 0;
        kept.push({
          step,
          length: 1,
          velocity: humanizeVelocity(params.velocity, params.velocityVariation, rng),
          pitch: { kind: 'degree', degree: this.nextDegree(prevDegree, isStrongStep(step, stepsPerBar), params, rng) },
        });
      }
      kept.sort((a, b) => a.step - b.step);
      return { lengthSteps: pattern.lengthSteps, events: trimOverlaps(kept, pattern.lengthSteps) };
    }
    return { lengthSteps: pattern.lengthSteps, events };
  }

  private nextDegree(current: number, strong: boolean, params: MotifParams, rng: Rng): number {
    const range = params.rangeDegrees;
    if (strong && rng.chance(params.chordToneBias)) {
      // Nearest chord tones (in any octave) to the current degree, within range.
      const candidates: number[] = [];
      for (let oct = -2; oct <= 2; oct++) {
        for (const d of CHORD_TONE_DEGREES) {
          const deg = d + oct * 7;
          if (Math.abs(deg) <= range && Math.abs(deg - current) <= params.maxLeap + 2) candidates.push(deg);
        }
      }
      if (candidates.length > 0) {
        const weights = candidates.map((c) => 1 / (1 + Math.abs(c - current)));
        return rng.weighted(candidates, weights);
      }
    }
    const leaps: number[] = [];
    const weights: number[] = [];
    for (let l = -params.maxLeap; l <= params.maxLeap; l++) {
      leaps.push(l);
      weights.push(l === 0 ? 0.5 : 1 / Math.abs(l));
    }
    let next = current + rng.weighted(leaps, weights);
    if (next > range) next = range - (next - range);
    if (next < -range) next = -range + (-range - next);
    return next;
  }
}

/** Shorten notes so they never overlap the next one or the pattern end. */
export function trimOverlaps(events: PatternEvent[], lengthSteps: number): PatternEvent[] {
  const sorted = [...events].sort((a, b) => a.step - b.step);
  return sorted.map((e, i) => {
    const nextStep = sorted[i + 1]?.step ?? lengthSteps;
    return { ...e, length: Math.max(0.5, Math.min(e.length, nextStep - e.step)) };
  });
}
