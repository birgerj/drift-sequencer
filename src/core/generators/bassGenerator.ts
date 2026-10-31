import type { Pattern, PatternEvent } from '../pattern/pattern';
import type { Rng } from '../random/rng';
import { trimOverlaps } from './motifGenerator';
import {
  humanizeVelocity,
  isStrongStep,
  type CommonParams,
  type GeneratorContext,
  type PatternGenerator,
} from './types';

export interface BassParams extends CommonParams {
  density: number;
  /** 0..1 chance a note is the fifth instead of the root. */
  fifthChance: number;
  /** 0..1 chance a note jumps up an octave. */
  octaveJumpChance: number;
  /** Prefer off-beat 8ths (house) over on-beat (techno). */
  offbeat: boolean;
}

export class BassGenerator implements PatternGenerator<BassParams> {
  readonly type = 'bass' as const;

  defaults(): BassParams {
    return {
      lengthSteps: 16,
      density: 0.5,
      fifthChance: 0.25,
      octaveJumpChance: 0.2,
      offbeat: false,
      mutation: 0.15,
      velocity: 100,
      velocityVariation: 0.2,
    };
  }

  generate(params: BassParams, ctx: GeneratorContext): Pattern {
    const events: PatternEvent[] = [];
    for (let step = 0; step < params.lengthSteps; step++) {
      const ev = this.eventFor(step, params, ctx);
      if (ev) events.push(ev);
    }
    return { lengthSteps: params.lengthSteps, events: trimOverlaps(events, params.lengthSteps) };
  }

  mutate(pattern: Pattern, params: BassParams, ctx: GeneratorContext): Pattern {
    const byStep = new Map(pattern.events.map((e) => [e.step, e]));
    for (let step = 0; step < pattern.lengthSteps; step++) {
      if (!ctx.rng.chance(params.mutation)) continue;
      const ev = this.eventFor(step, params, ctx);
      if (ev) byStep.set(step, ev);
      else if (step !== 0) byStep.delete(step);
    }
    const events = [...byStep.values()].sort((a, b) => a.step - b.step);
    return { lengthSteps: pattern.lengthSteps, events: trimOverlaps(events, pattern.lengthSteps) };
  }

  private eventFor(step: number, params: BassParams, ctx: GeneratorContext): PatternEvent | undefined {
    const { rng, stepsPerBar } = ctx;
    const isDownbeat = step % stepsPerBar === 0;
    const eighth = step % 2 === 0;
    const offbeatEighth = eighth && !isStrongStep(step, stepsPerBar);
    let p = params.density * (eighth ? 1 : 0.35);
    if (params.offbeat) p = offbeatEighth ? Math.min(1, params.density + 0.4) : p * 0.4;
    if (!isDownbeat && !rng.chance(p)) return undefined;
    if (isDownbeat && params.offbeat && !rng.chance(0.5)) return undefined;
    return {
      step,
      length: eighth ? 2 : 1,
      velocity: humanizeVelocity(params.velocity, params.velocityVariation, rng, isDownbeat ? 8 : 0),
      pitch: this.pitch(isDownbeat, params, rng),
    };
  }

  private pitch(isDownbeat: boolean, params: BassParams, rng: Rng): PatternEvent['pitch'] {
    if (isDownbeat) return { kind: 'chordTone', index: 0, octave: 0 };
    const index = rng.chance(params.fifthChance) ? 2 : 0;
    const octave = rng.chance(params.octaveJumpChance) ? 1 : 0;
    return { kind: 'chordTone', index, octave };
  }
}
