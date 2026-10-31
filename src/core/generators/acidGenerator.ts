import type { Pattern, PatternEvent } from '../pattern/pattern';
import type { Rng } from '../random/rng';
import type { CommonParams, GeneratorContext, PatternGenerator } from './types';

/**
 * TB-303 style lines: 16 steps, each a note or a rest, with octave up/down,
 * accent and slide — the four things that make acid sound like acid.
 * Notes are scale degrees from the current chord root, so lines stay in key.
 */
export interface AcidParams extends CommonParams {
  /** 0..1 — notes vs rests. */
  density: number;
  accentChance: number;
  slideChance: number;
  octaveUpChance: number;
  octaveDownChance: number;
  /** How many different scale degrees the line uses (2–7). */
  noteVariety: number;
  /** Fraction of a step a normal note is held; ~0.58 is the 303's own gate. */
  gate: number;
}

/** Degrees in order of "acid-ness": root, fifth, minor 7th, third, fourth, second, sixth. */
const DEGREE_ORDER = [0, 4, 6, 2, 3, 1, 5];

export class AcidGenerator implements PatternGenerator<AcidParams> {
  readonly type = 'acid' as const;

  defaults(): AcidParams {
    return {
      lengthSteps: 16,
      density: 0.75,
      accentChance: 0.3,
      slideChance: 0.22,
      octaveUpChance: 0.22,
      octaveDownChance: 0.08,
      noteVariety: 4,
      gate: 0.58,
      mutation: 0.12,
      velocity: 88,
      velocityVariation: 0,
    };
  }

  generate(params: AcidParams, ctx: GeneratorContext): Pattern {
    const events: PatternEvent[] = [];
    let prevWasNote = false;
    for (let step = 0; step < params.lengthSteps; step++) {
      const ev = this.stepEvent(step, prevWasNote, params, ctx.rng);
      if (ev) events.push(ev);
      prevWasNote = !!ev;
    }
    return { lengthSteps: params.lengthSteps, events };
  }

  mutate(pattern: Pattern, params: AcidParams, ctx: GeneratorContext): Pattern {
    const { rng } = ctx;
    const byStep = new Map(pattern.events.map((e) => [e.step, { ...e }]));
    for (let step = 0; step < pattern.lengthSteps; step++) {
      if (!rng.chance(params.mutation)) continue;
      const ev = byStep.get(step);
      const what = rng.pick(['note', 'octave', 'accent', 'slide', 'rest'] as const);
      if (!ev || what === 'rest') {
        if (ev && step !== 0) byStep.delete(step);
        else if (!ev) {
          const fresh = this.stepEvent(step, byStep.has(step - 1), params, rng, true);
          if (fresh) byStep.set(step, fresh);
        }
        continue;
      }
      if (ev.pitch.kind !== 'degree') continue;
      if (what === 'note') ev.pitch = { ...ev.pitch, degree: this.pickDegree(params, rng) };
      if (what === 'octave') ev.pitch = { ...ev.pitch, octave: this.pickOctave(params, rng) };
      if (what === 'accent') ev.accent = !ev.accent;
      if (what === 'slide' && byStep.has(step - 1)) ev.slide = !ev.slide;
    }
    // A slide needs a note right before it.
    const events = [...byStep.values()]
      .sort((a, b) => a.step - b.step)
      .map((e) => (e.slide && !byStep.has(e.step - 1) && e.step !== 0 ? { ...e, slide: false } : e));
    return { lengthSteps: pattern.lengthSteps, events };
  }

  private stepEvent(step: number, prevWasNote: boolean, p: AcidParams, rng: Rng, force = false): PatternEvent | undefined {
    const downbeat = step % 4 === 0;
    const play = force || step === 0 || rng.chance(Math.min(1, p.density + (downbeat ? 0.15 : 0)));
    if (!play) return undefined;
    const ev: PatternEvent = {
      step,
      length: p.gate,
      velocity: p.velocity,
      pitch: { kind: 'degree', degree: step === 0 ? 0 : this.pickDegree(p, rng), octave: step === 0 ? 0 : this.pickOctave(p, rng) },
    };
    if (rng.chance(p.accentChance + (downbeat ? 0.1 : 0))) ev.accent = true;
    if (prevWasNote && step > 0 && rng.chance(p.slideChance)) ev.slide = true;
    return ev;
  }

  private pickDegree(p: AcidParams, rng: Rng): number {
    const pool = DEGREE_ORDER.slice(0, Math.max(2, Math.min(7, Math.round(p.noteVariety))));
    // The root dominates; the rest are colour.
    return rng.weighted(pool, pool.map((_, i) => (i === 0 ? 3 : 1 / (1 + i * 0.3))));
  }

  private pickOctave(p: AcidParams, rng: Rng): number {
    const r = rng.next();
    if (r < p.octaveUpChance) return 1;
    if (r < p.octaveUpChance + p.octaveDownChance) return -1;
    return 0;
  }
}
