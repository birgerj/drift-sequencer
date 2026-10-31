import type { Pattern, PatternEvent } from '../pattern/pattern';
import { euclid } from './euclid';
import { humanizeVelocity, type CommonParams, type GeneratorContext, type PatternGenerator } from './types';

export interface ChordParams extends CommonParams {
  style: 'sustain' | 'pulse';
  /** For `pulse`: hits per bar, spread euclidean. */
  pulses: number;
  /** 0..1 fraction of the gap a hit is held. */
  gate: number;
}

export class ChordGenerator implements PatternGenerator<ChordParams> {
  readonly type = 'chords' as const;

  defaults(): ChordParams {
    return {
      lengthSteps: 16,
      style: 'sustain',
      pulses: 3,
      gate: 0.9,
      mutation: 0.1,
      velocity: 80,
      velocityVariation: 0.1,
    };
  }

  generate(params: ChordParams, ctx: GeneratorContext): Pattern {
    const { stepsPerBar, rng } = ctx;
    const events: PatternEvent[] = [];
    // One segment per bar (or the whole pattern when it is shorter than a bar).
    const seg = Math.min(stepsPerBar, params.lengthSteps);
    const bars = Math.max(1, Math.round(params.lengthSteps / seg));
    for (let bar = 0; bar < bars; bar++) {
      const offset = bar * seg;
      if (params.style === 'sustain') {
        events.push({
          step: offset,
          length: seg * params.gate,
          velocity: humanizeVelocity(params.velocity, params.velocityVariation, rng),
          pitch: { kind: 'chord' },
        });
        continue;
      }
      const hits = euclid(Math.round((params.pulses * seg) / stepsPerBar) || 1, seg, rng.int(0, 2));
      const starts = hits.flatMap((h, i) => (h ? [i] : []));
      starts.forEach((s, i) => {
        const gap = (starts[i + 1] ?? seg) - s;
        events.push({
          step: offset + s,
          length: Math.max(0.5, gap * params.gate),
          velocity: humanizeVelocity(params.velocity, params.velocityVariation, rng),
          pitch: { kind: 'chord' },
        });
      });
    }
    return { lengthSteps: bars * seg, events };
  }

  mutate(pattern: Pattern, params: ChordParams, ctx: GeneratorContext): Pattern {
    if (params.style === 'sustain' || !ctx.rng.chance(params.mutation)) return pattern;
    return this.generate(params, ctx);
  }
}
