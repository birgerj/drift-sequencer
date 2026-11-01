import { describe, expect, it } from 'vitest';
import {
  bestTransposition,
  scoreTrio,
  degreeOf,
  evolveLatent,
  randomLatent,
  slerp,
  snapToChordTone,
  trioToPatterns,
  TRIO_STEPS,
  type TrioNote,
} from '../src/core/ensemble/trio';
import { TrackRuntime } from '../src/core/engine/trackRuntime';
import { resolvePitch } from '../src/core/pattern/resolve';
import { Harmony } from '../src/core/theory/harmony';
import { Scale } from '../src/core/theory/scale';
import { createProject } from '../src/state/templates';

const mel = (pitch: number, start: number, end = start + 2): TrioNote => ({ pitch, start, end, instrument: 0, isDrum: false });
const bass = (pitch: number, start: number, end = start + 4): TrioNote => ({ pitch, start, end, instrument: 1, isDrum: false });
const drum = (pitch: number, start: number): TrioNote => ({ pitch, start, end: start + 1, instrument: 2, isDrum: true });

const A_MINOR = new Scale(9, 'aeolian');
const C_MAJOR = new Scale(0, 'ionian');

describe('trio conversion', () => {
  it('maps notes to scale degrees, snapping off-key notes', () => {
    expect(degreeOf(60, C_MAJOR)).toBe(35); // C4 = 5 octaves × 7
    expect(degreeOf(64, C_MAJOR)).toBe(37); // E
    expect(degreeOf(61, C_MAJOR)).toBe(36); // C# → D (tie goes up)
    expect(degreeOf(71, C_MAJOR)).toBe(41); // B
    expect(degreeOf(57, A_MINOR)).toBe(28); // A3 is the root
  });

  it('snaps to chord tones on the beat', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => snapToChordTone(d, 7))).toEqual([0, 0, 2, 2, 4, 4, 7]);
    expect(snapToChordTone(-1, 7)).toBe(0);
    expect(snapToChordTone(3, 5)).toBe(3); // pentatonic: left alone
  });

  it('transposes a trio into the key', () => {
    // A trio in D major moved to C major: two semitones down.
    const dMajor = [62, 64, 66, 67, 69, 71, 73].map((p, i) => mel(p, i * 2));
    expect(bestTransposition(dMajor, C_MAJOR)).toBe(-2);
    expect(bestTransposition([mel(60, 0), mel(64, 2), mel(67, 4)], C_MAJOR)).toBe(0);
  });

  it('writes three 4-bar patterns that stay in key and follow the chords', () => {
    const notes = [
      mel(72, 0), mel(74, 2), mel(76, 4), mel(77, 6), mel(79, 8, 12), mel(78, 12),
      bass(36, 0), bass(43, 8), bass(41, 16), bass(38, 24),
      drum(36, 0), drum(42, 2), drum(38, 4), drum(45, 6), drum(36, 8), drum(99, 9),
    ];
    const { melody, bass: b, drums } = trioToPatterns(notes, { scale: C_MAJOR });
    expect(melody.lengthSteps).toBe(TRIO_STEPS);
    expect(melody.events).toHaveLength(6);
    expect(b.events).toHaveLength(4);
    // Unknown drum pitch dropped; low tom goes to the TR-8S LT note.
    expect(drums.events.map((e) => e.pitch.kind === 'fixed' && e.pitch.note)).toEqual([36, 42, 38, 43, 36]);
    // The line keeps its shape (key degrees); only bar downbeats and halves are bent onto the chord.
    expect(melody.events.every((e) => e.pitch.kind === 'keyDegree' && e.pitch.nearest)).toBe(true);
    const fits = (p: typeof melody, step: number) => {
      const e = p.events.find((x) => x.step === step)!;
      return e.pitch.kind === 'keyDegree' ? e.pitch.fit : undefined;
    };
    expect([fits(melody, 0), fits(melody, 8), fits(melody, 2), fits(melody, 12)]).toEqual(['tone', 'tone', undefined, undefined]);
    expect([fits(b, 0), fits(b, 8), fits(b, 16)]).toEqual(['root', 'tone', 'root']);
    // Other fit settings.
    const off = trioToPatterns(notes, { scale: C_MAJOR, fit: 'off' });
    expect(off.melody.events.some((e) => e.pitch.kind === 'keyDegree' && e.pitch.fit)).toBe(false);
    const beat = trioToPatterns(notes, { scale: C_MAJOR, fit: 'beat' });
    expect([fits(beat.melody, 4), fits(beat.melody, 2)]).toEqual(['tone', undefined]);
    const bar = trioToPatterns(notes, { scale: C_MAJOR, fit: 'bar' });
    expect([fits(bar.melody, 0), fits(bar.melody, 8)]).toEqual(['tone', undefined]);

    // Resolve against a C – F progression: every note is in key.
    const harmony = new Harmony(C_MAJOR, [{ degree: 0, bars: 2 }, { degree: 3, bars: 2 }]);
    const register = { baseOctave: 5, low: 48, high: 96 };
    for (const pattern of [melody, b]) {
      for (const e of pattern.events) {
        const bar = Math.floor(e.step / 16);
        const moment = harmony.at(bar);
        const [n] = resolvePitch(e.pitch, moment, register, {});
        expect(C_MAJOR.contains(n!)).toBe(true);
        if (e.pitch.kind === 'keyDegree' && e.pitch.fit) expect(moment.chord.contains(n!)).toBe(true);
      }
    }
  });

  it('handles an empty decode', () => {
    const p = trioToPatterns([], { scale: A_MINOR });
    expect([p.melody, p.bass, p.drums].every((x) => x.events.length === 0 && x.lengthSteps === TRIO_STEPS)).toBe(true);
  });
});

describe('trio scoring', () => {
  const groove = [0, 16, 32, 48].flatMap((b) => [drum(36, b), drum(36, b + 8), drum(38, b + 4), drum(38, b + 12), ...[0, 2, 4, 6, 8, 10, 12, 14].map((s) => drum(42, b + s))]);
  const tune = [60, 62, 64, 67, 65, 64, 62, 60, 64, 65, 67, 69, 67, 65, 64, 62].map((p, i) => mel(p, i * 4));
  const walking = [36, 36, 43, 41, 38, 38, 41, 43].map((p, i) => bass(p, i * 8));

  it('prefers a real groove and a moving melody', () => {
    const good = scoreTrio([...groove, ...tune, ...walking]);
    const droning = scoreTrio([...groove, ...tune.map((n) => ({ ...n, pitch: 64 })), ...walking]);
    const noKick = scoreTrio([...groove.filter((n) => n.pitch !== 36), ...tune, ...walking]);
    const empty = scoreTrio([...groove, ...walking]);
    expect(good).toBeGreaterThan(0.8);
    expect(droning).toBeLessThan(good);
    expect(noKick).toBeLessThan(good);
    expect(empty).toBeLessThan(good);
  });

  it('prefers the density you ask for', () => {
    const sparseTune = tune.filter((_, i) => i % 2 === 0);
    const busyTune = [...tune, ...tune.map((n) => ({ ...n, start: n.start + 2, end: n.start + 3, pitch: n.pitch + 2 }))];
    const parts = { melody: true, bass: false, drums: false };
    expect(scoreTrio(busyTune, parts, { melody: 'busy' })).toBeGreaterThan(scoreTrio(sparseTune, parts, { melody: 'busy' }));
    expect(scoreTrio(sparseTune, parts, { melody: 'sparse' })).toBeGreaterThan(scoreTrio(busyTune, parts, { melody: 'sparse' }));
  });

  it('only scores the parts that are linked', () => {
    const notes = [...tune, ...walking];
    expect(scoreTrio(notes, { melody: true, bass: true, drums: false })).toBeGreaterThan(scoreTrio(notes));
  });
});

describe('latent space', () => {
  const rand = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();

  it('random latents look standard normal', () => {
    const z = randomLatent(4000, rand);
    const mean = z.reduce((a, b) => a + b, 0) / z.length;
    const variance = z.reduce((a, b) => a + (b - mean) ** 2, 0) / z.length;
    expect(Math.abs(mean)).toBeLessThan(0.1);
    expect(variance).toBeGreaterThan(0.85);
    expect(variance).toBeLessThan(1.15);
    expect(randomLatent(3, rand)).toHaveLength(3);
  });

  it('slerp hits both ends', () => {
    const a = randomLatent(16, rand);
    const b = randomLatent(16, rand);
    slerp(a, b, 0).forEach((x, i) => expect(x).toBeCloseTo(a[i]!));
    slerp(a, b, 1).forEach((x, i) => expect(x).toBeCloseTo(b[i]!));
  });

  it('evolving moves a little, more with a higher amount', () => {
    const z = randomLatent(256, rand);
    const dist = (v: number[]) => Math.sqrt(v.reduce((s, x, i) => s + (x - z[i]!) ** 2, 0));
    expect(evolveLatent(z, 0, rand)).toEqual(z);
    expect(dist(evolveLatent(z, 0.2, rand))).toBeLessThan(dist(evolveLatent(z, 1, rand)));
  });
});


describe('tracks driven by the ensemble', () => {
  const track = () => {
    const t = createProject('techno').tracks.find((x) => x.generator.type === 'bass')!;
    return new TrackRuntime({ ...t, frozen: false, mutationIntervalBars: 1 }, 16);
  };
  const four = { lengthSteps: 64, events: [{ step: 0, length: 1, velocity: 90, pitch: { kind: 'degree' as const, degree: 0 } }] };

  it('don’t mutate on their own', () => {
    const rt = track();
    rt.external = true;
    const before = rt.pattern;
    for (let bar = 1; bar < 9; bar++) expect(rt.maybeMutate(bar)).toBe(false);
    expect(rt.pattern).toBe(before);
  });

  it('switch to a queued 4-bar pattern only at a phrase start', () => {
    const rt = track();
    rt.external = true;
    rt.queuePattern(four);
    expect(rt.maybeMutate(5)).toBe(false);
    expect(rt.maybeMutate(7)).toBe(false);
    expect(rt.maybeMutate(8)).toBe(true);
    expect(rt.pattern).toBe(four);
    expect(rt.lastChange).toBe('ensemble');
    expect(rt.pending).toBeUndefined();
  });
});
