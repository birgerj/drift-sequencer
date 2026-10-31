import { describe, expect, it } from 'vitest';
import { euclid } from '../src/core/generators/euclid';
import { defaultConfig, generatePattern, mutatePattern } from '../src/core/generators/registry';
import type { TrackType } from '../src/core/generators/types';
import { resolvePitch } from '../src/core/pattern/resolve';
import { Rng } from '../src/core/random/rng';
import { Harmony } from '../src/core/theory/harmony';
import { parsePitchClass } from '../src/core/theory/note';
import { Scale } from '../src/core/theory/scale';

const scale = new Scale(parsePitchClass('D'), 'dorian');
const harmony = new Harmony(scale, [
  { degree: 0, bars: 1, size: 4 },
  { degree: 3, bars: 1 },
  { degree: 4, bars: 1 },
]);
const ctx = (seed = 1) => ({ rng: new Rng(seed), stepsPerBar: 16 });
const types: TrackType[] = ['motif', 'arp', 'bass', 'acid', 'chords', 'drone', 'drums'];

describe('euclid', () => {
  it('spreads pulses evenly', () => {
    expect(euclid(3, 8).map((x) => (x ? 'x' : '.')).join('')).toBe('x..x..x.');
    expect(euclid(4, 16).filter(Boolean)).toHaveLength(4);
    expect(euclid(1, 4, 1).map((x) => (x ? 'x' : '.')).join('')).toBe('.x..');
  });
});

describe('generators', () => {
  it.each(types)('%s is deterministic for a seed', (type) => {
    const config = defaultConfig(type);
    expect(generatePattern(config, ctx(42))).toEqual(generatePattern(config, ctx(42)));
  });

  it.each(types)('%s keeps events inside the pattern', (type) => {
    const config = defaultConfig(type);
    const pattern = generatePattern(config, ctx(7));
    for (const e of pattern.events) {
      expect(e.step).toBeGreaterThanOrEqual(0);
      expect(e.step).toBeLessThan(pattern.lengthSteps);
      expect(e.velocity).toBeGreaterThanOrEqual(1);
      expect(e.velocity).toBeLessThanOrEqual(127);
    }
  });

  it.each(['motif', 'arp', 'bass', 'acid', 'chords', 'drone'] as TrackType[])(
    '%s always resolves to notes in key, every bar',
    (type) => {
      const config = defaultConfig(type);
      let pattern = generatePattern(config, ctx(3));
      const register = { baseOctave: 3, low: 40, high: 84 };
      for (let bar = 0; bar < 12; bar++) {
        const state = {};
        for (const e of pattern.events) {
          for (const note of resolvePitch(e.pitch, harmony.at(bar), register, state)) {
            expect(scale.contains(note)).toBe(true);
            expect(note).toBeGreaterThanOrEqual(register.low);
            expect(note).toBeLessThanOrEqual(register.high);
          }
        }
        pattern = mutatePattern(config, pattern, ctx(bar + 10));
      }
    },
  );

  it('motif mutation changes only part of the pattern', () => {
    const config = defaultConfig('motif');
    if (config.type !== 'motif') throw new Error();
    config.params.rhythmLock = true;
    config.params.mutation = 0.2;
    const a = generatePattern(config, ctx(5));
    const b = mutatePattern(config, a, ctx(6));
    expect(b.events.map((e) => e.step)).toEqual(a.events.map((e) => e.step));
    const changed = b.events.filter((e, i) => JSON.stringify(e.pitch) !== JSON.stringify(a.events[i]!.pitch));
    expect(changed.length).toBeLessThan(a.events.length);
  });

  it('bass lands on the chord root on the downbeat', () => {
    const pattern = generatePattern(defaultConfig('bass'), ctx(9));
    const downbeat = pattern.events.find((e) => e.step === 0);
    expect(downbeat?.pitch).toEqual({ kind: 'chordTone', index: 0, octave: 0 });
  });
});
