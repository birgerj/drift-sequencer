import type { Pattern, PatternEvent } from '../pattern/pattern';
import { humanizeVelocity, type CommonParams, type GeneratorContext, type PatternGenerator } from './types';

export type ArpDirection = 'up' | 'down' | 'upDown' | 'random';

export interface ArpParams extends CommonParams {
  direction: ArpDirection;
  octaves: number;
  /** Steps between notes (1 = 16ths, 2 = 8ths). */
  rate: number;
  /** 0..1 chance each note is skipped. */
  restChance: number;
  gate: number;
}

export class ArpGenerator implements PatternGenerator<ArpParams> {
  readonly type = 'arp' as const;

  defaults(): ArpParams {
    return {
      lengthSteps: 16,
      direction: 'upDown',
      octaves: 2,
      rate: 1,
      restChance: 0.1,
      gate: 0.6,
      mutation: 0.15,
      velocity: 90,
      velocityVariation: 0.25,
    };
  }

  generate(params: ArpParams, ctx: GeneratorContext): Pattern {
    const { rng } = ctx;
    const ladder = this.ladder(params);
    const events: PatternEvent[] = [];
    let i = 0;
    for (let step = 0; step < params.lengthSteps; step += params.rate) {
      const pos = params.direction === 'random' ? rng.int(0, ladder.length - 1) : i % ladder.length;
      i++;
      if (step > 0 && rng.chance(params.restChance)) continue;
      const rung = ladder[pos]!;
      events.push({
        step,
        length: params.rate * params.gate,
        velocity: humanizeVelocity(params.velocity, params.velocityVariation, rng, step % 4 === 0 ? 8 : 0),
        pitch: { kind: 'chordTone', index: rung.index, octave: rung.octave },
      });
    }
    return { lengthSteps: params.lengthSteps, events };
  }

  mutate(pattern: Pattern, params: ArpParams, ctx: GeneratorContext): Pattern {
    const events = pattern.events.map((e) => {
      if (!ctx.rng.chance(params.mutation) || e.pitch.kind !== 'chordTone') return e;
      const delta = ctx.rng.pick([-1, 1]);
      return { ...e, pitch: { ...e.pitch, index: Math.max(0, e.pitch.index + delta) } };
    });
    return { lengthSteps: pattern.lengthSteps, events };
  }

  /** Chord-tone positions in playing order: index 0..2 per octave. */
  private ladder(params: ArpParams): { index: number; octave: number }[] {
    const up: { index: number; octave: number }[] = [];
    for (let o = 0; o < Math.max(1, params.octaves); o++) for (let t = 0; t < 3; t++) up.push({ index: t, octave: o });
    switch (params.direction) {
      case 'up':
      case 'random':
        return up;
      case 'down':
        return [...up].reverse();
      case 'upDown':
        return [...up, ...up.slice(1, -1).reverse()];
    }
  }
}
