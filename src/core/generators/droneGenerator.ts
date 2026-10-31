import type { Pattern } from '../pattern/pattern';
import type { CommonParams, GeneratorContext, PatternGenerator } from './types';

export interface DroneParams extends CommonParams {
  /** Follow the chord root, or hold the key's root regardless of chords. */
  follow: 'chord' | 'key';
}

export class DroneGenerator implements PatternGenerator<DroneParams> {
  readonly type = 'drone' as const;

  defaults(): DroneParams {
    return { lengthSteps: 16, follow: 'key', mutation: 0, velocity: 70, velocityVariation: 0 };
  }

  generate(params: DroneParams, _ctx: GeneratorContext): Pattern {
    return {
      lengthSteps: params.lengthSteps,
      events: [
        {
          step: 0,
          length: params.lengthSteps,
          velocity: params.velocity,
          pitch: params.follow === 'key' ? { kind: 'keyDegree', degree: 0 } : { kind: 'chordTone', index: 0, octave: 0 },
        },
      ],
    };
  }

  mutate(pattern: Pattern): Pattern {
    return pattern;
  }
}
