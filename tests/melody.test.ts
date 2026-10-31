import { describe, expect, it } from 'vitest';
import { generatePattern, mutatePattern, defaultConfig } from '../src/core/generators/registry';
import { isChordTone, scoreMelody } from '../src/core/generators/phraseMelody';
import { Rng } from '../src/core/random/rng';
import { Harmony } from '../src/core/theory/harmony';
import { Scale } from '../src/core/theory/scale';
import { resolvePitch, type ResolveState } from '../src/core/pattern/resolve';
import type { Pattern } from '../src/core/pattern/pattern';

const ctx = (seed: number) => ({ rng: new Rng(seed), stepsPerBar: 16 });
const register = { baseOctave: 4, low: 60, high: 84 };
const harmony = new Harmony(new Scale(0, 'aeolian'), [
  { degree: 0, bars: 1 },
  { degree: 5, bars: 1 },
  { degree: 2, bars: 1 },
  { degree: 6, bars: 1 },
]);

function motif(style: 'phrase' | 'walk', lengthSteps = 64) {
  const config = defaultConfig('motif');
  if (config.type !== 'motif') throw new Error();
  config.params.style = style;
  config.params.lengthSteps = lengthSteps;
  return config;
}

/** Play a pattern over the progression and return the MIDI line. */
function play(pattern: Pattern): number[] {
  const state: ResolveState = {};
  return pattern.events.map((e) => resolvePitch(e.pitch, harmony.at(Math.floor(e.step / 16)), register, state)[0]!);
}

function stats(style: 'phrase' | 'walk') {
  let bigJumps = 0;
  let moves = 0;
  let strongOff = 0;
  let strong = 0;
  let score = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const config = motif(style);
    const p = generatePattern(config, ctx(seed));
    const line = play(p);
    for (let i = 1; i < line.length; i++, moves++) if (Math.abs(line[i]! - line[i - 1]!) > 9) bigJumps++;
    for (const e of p.events) {
      if (e.step % 4 !== 0 || e.pitch.kind !== 'degree') continue;
      strong++;
      if (!isChordTone(e.pitch.degree)) strongOff++;
    }
    if (config.type === 'motif') score += scoreMelody(p, { ...config.params }, 16);
  }
  return { jumpRate: bigJumps / moves, strongOffRate: strongOff / strong, score: score / 60 };
}

describe('phrase melodies', () => {
  it('are smoother and more consonant than the random walk', () => {
    const phrase = stats('phrase');
    const walk = stats('walk');
    expect(phrase.jumpRate).toBeLessThan(walk.jumpRate);
    expect(phrase.jumpRate).toBeLessThan(0.03);
    expect(phrase.strongOffRate).toBeLessThan(0.1);
    expect(phrase.score).toBeGreaterThan(walk.score);
  });

  it('repeat their opening phrase and end on the chord root', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = generatePattern(motif('phrase'), ctx(seed));
      const bar = (b: number) => p.events.filter((e) => Math.floor(e.step / 16) === b);
      const a = bar(0);
      const a2 = bar(1);
      expect(a2[0]?.step! - 16).toBe(a[0]?.step);
      expect(a2[0]?.pitch).toEqual(a[0]?.pitch);
      const last = p.events[p.events.length - 1]!;
      expect(last.pitch.kind === 'degree' && last.pitch.degree % 7).toBe(0);
    }
  });

  it('mutation keeps the phrase recognisable', () => {
    const config = motif('phrase');
    config.params.mutation = 0.2;
    const a = generatePattern(config, ctx(3));
    let b = a;
    for (let i = 0; i < 3; i++) b = mutatePattern(config, b, ctx(100 + i));
    const same = b.events.filter((e) => a.events.some((x) => x.step === e.step && JSON.stringify(x.pitch) === JSON.stringify(e.pitch)));
    expect(same.length / a.events.length).toBeGreaterThan(0.5);
    const last = b.events[b.events.length - 1]!;
    expect(last.pitch.kind === 'degree' && last.pitch.degree % 7).toBe(0);
  });

  it('works for short patterns and odd bar sizes', () => {
    for (const [len, spb] of [[8, 16], [16, 16], [24, 12], [40, 16]] as const) {
      const config = motif('phrase', len);
      const p = generatePattern(config, { rng: new Rng(7), stepsPerBar: spb });
      expect(p.events.length).toBeGreaterThan(0);
      for (const e of p.events) {
        expect(e.step).toBeLessThan(len);
        expect(e.step + e.length).toBeLessThanOrEqual(len);
      }
    }
  });
});
