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
  /** 0..1 chance a busy voice's hit becomes a ratchet (hats rolls). */
  ratchetChance?: number;
  /** 0..1 chance an off-beat hit only plays every other pass (1:2 / 2:2). */
  conditionChance?: number;
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
      ratchetChance: 0.06,
      conditionChance: 0.1,
      // All 11 TR-8S instruments get a lane; toms and cymbals start empty.
      voices: [
        { name: 'BD', note: TR8S_NOTES.BD, pulses: 4, rotate: 0, probability: 1, velocity: 110 },
        { name: 'SD', note: TR8S_NOTES.SD, pulses: 2, rotate: 4, probability: 1, velocity: 100 },
        { name: 'LT', note: TR8S_NOTES.LT, pulses: 0, rotate: 0, probability: 1, velocity: 95 },
        { name: 'MT', note: TR8S_NOTES.MT, pulses: 0, rotate: 0, probability: 1, velocity: 95 },
        { name: 'HT', note: TR8S_NOTES.HT, pulses: 0, rotate: 0, probability: 1, velocity: 95 },
        { name: 'RS', note: TR8S_NOTES.RS, pulses: 0, rotate: 3, probability: 0.6, velocity: 90 },
        { name: 'CP', note: TR8S_NOTES.CP, pulses: 1, rotate: 12, probability: 0.4, velocity: 95 },
        { name: 'CH', note: TR8S_NOTES.CH, pulses: 8, rotate: 0, probability: 0.85, velocity: 80 },
        { name: 'OH', note: TR8S_NOTES.OH, pulses: 4, rotate: 2, probability: 0.6, velocity: 85 },
        { name: 'CC', note: TR8S_NOTES.CC, pulses: 0, rotate: 0, probability: 1, velocity: 100 },
        { name: 'RC', note: TR8S_NOTES.RC, pulses: 0, rotate: 0, probability: 1, velocity: 80 },
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
    // Voices are defined per 16-step bar; longer patterns repeat it, an
    // 8-step pattern uses half of the hits.
    const cycle = Math.min(params.lengthSteps, 16);
    const pulses = Math.round((voice.pulses * cycle) / 16);
    const bar = euclid(pulses, cycle, rotate);
    const hits = Array.from({ length: params.lengthSteps }, (_, i) => bar[i % cycle]!);
    const busy = pulses >= cycle / 2;
    return hits.flatMap((hit, step): PatternEvent[] => {
      if (!hit) return [];
      const ev: PatternEvent = {
        step,
        length: 0.5,
        velocity: humanizeVelocity(voice.velocity, params.velocityVariation, ctx.rng),
        pitch: { kind: 'fixed', note: voice.note },
        probability: voice.probability,
      };
      if (busy && ctx.rng.chance(params.ratchetChance ?? 0)) ev.ratchet = ctx.rng.pick([2, 2, 3]);
      if (step % 4 !== 0 && ctx.rng.chance(params.conditionChance ?? 0)) {
        ev.condition = ctx.rng.pick([
          { on: 1, every: 2 },
          { on: 2, every: 2 },
          { on: 4, every: 4 },
        ]);
      }
      return [ev];
    });
  }
}

function sortEvents(events: PatternEvent[]): PatternEvent[] {
  return [...events].sort((a, b) => a.step - b.step);
}
