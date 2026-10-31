import type { Pattern, PatternEvent } from '../pattern/pattern';
import type { MidiNote } from '../theory/note';
import { euclid } from './euclid';
import { humanizeVelocity, type GeneratorContext, type PatternGenerator } from './types';

export interface DrumVoice {
  name: string;
  note: MidiNote;
  pulses: number;
  rotate: number;
  /** 0..1 chance each hit plays. */
  probability: number;
  velocity: number;
}

export interface DrumParams {
  lengthSteps: number;
  voices: DrumVoice[];
  /** 0..1 chance a voice's rhythm shifts on mutation. */
  mutation: number;
  velocityVariation: number;
}

/** Default note map of the Roland TR-8S (channel 10). */
export const TR8S_NOTES = {
  BD: 36,
  RS: 37,
  SD: 38,
  CP: 39,
  CH: 42,
  LT: 43,
  OH: 46,
  MT: 47,
  CC: 49,
  HT: 50,
  RC: 51,
} as const;

export class DrumGenerator implements PatternGenerator<DrumParams> {
  readonly type = 'drums' as const;

  defaults(): DrumParams {
    return {
      lengthSteps: 16,
      mutation: 0.15,
      velocityVariation: 0.2,
      voices: [
        { name: 'BD', note: TR8S_NOTES.BD, pulses: 4, rotate: 0, probability: 1, velocity: 110 },
        { name: 'SD', note: TR8S_NOTES.SD, pulses: 2, rotate: 4, probability: 1, velocity: 100 },
        { name: 'CH', note: TR8S_NOTES.CH, pulses: 8, rotate: 0, probability: 0.85, velocity: 80 },
        { name: 'OH', note: TR8S_NOTES.OH, pulses: 4, rotate: 2, probability: 0.6, velocity: 85 },
        { name: 'CP', note: TR8S_NOTES.CP, pulses: 1, rotate: 12, probability: 0.4, velocity: 95 },
      ],
    };
  }

  generate(params: DrumParams, ctx: GeneratorContext): Pattern {
    const events = params.voices.flatMap((v) => this.voiceEvents(v, v.rotate, params, ctx));
    return { lengthSteps: params.lengthSteps, events: sortEvents(events) };
  }

  mutate(pattern: Pattern, params: DrumParams, ctx: GeneratorContext): Pattern {
    let events = pattern.events;
    for (const voice of params.voices) {
      if (!ctx.rng.chance(params.mutation)) continue;
      const shift = ctx.rng.pick([-1, 1]);
      events = events.filter((e) => !(e.pitch.kind === 'fixed' && e.pitch.note === voice.note));
      events = events.concat(this.voiceEvents(voice, voice.rotate + shift, params, ctx));
    }
    return { lengthSteps: pattern.lengthSteps, events: sortEvents(events) };
  }

  private voiceEvents(voice: DrumVoice, rotate: number, params: DrumParams, ctx: GeneratorContext): PatternEvent[] {
    const hits = euclid(voice.pulses, params.lengthSteps, rotate);
    return hits.flatMap((hit, step) =>
      hit
        ? [
            {
              step,
              length: 0.5,
              velocity: humanizeVelocity(voice.velocity, params.velocityVariation, ctx.rng),
              pitch: { kind: 'fixed', note: voice.note } as const,
              probability: voice.probability,
            },
          ]
        : [],
    );
  }
}

function sortEvents(events: PatternEvent[]): PatternEvent[] {
  return [...events].sort((a, b) => a.step - b.step);
}
