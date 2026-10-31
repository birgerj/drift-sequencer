import { describe, expect, it } from 'vitest';
import { answerEvents, phraseActive, transformPitch } from '../src/core/engine/phrasing';
import { LookaheadScheduler, type TimerHost } from '../src/core/engine/scheduler';
import { Sequencer } from '../src/core/engine/sequencer';
import { cycleCondition, cycleRatchet, drumAt } from '../src/core/pattern/edit';
import { conditionMet, type Pattern } from '../src/core/pattern/pattern';
import { Rng } from '../src/core/random/rng';
import { Chord } from '../src/core/theory/chord';
import { parsePitchClass } from '../src/core/theory/note';
import { generateProgression, PROGRESSION_STYLES, varyProgression } from '../src/core/theory/progressionGenerator';
import { Scale } from '../src/core/theory/scale';
import { RecordingOutput, StaticPortResolver } from '../src/io/midi/output';
import { createProject } from '../src/state/templates';

class FakeTimer implements TimerHost {
  time = 0;
  now = () => this.time;
  setInterval = () => 1;
  clearInterval = () => {};
}
/** Advance the fake clock in 25 ms ticks, like the real worker clock. */
const runUntil = (seq: Sequencer, timer: FakeTimer, until: number) => {
  const sched = (seq as unknown as { scheduler: LookaheadScheduler }).scheduler;
  while (timer.time < until) {
    timer.time = Math.min(until, timer.time + 25);
    sched.tick();
  }
};

describe('progression generator', () => {
  const scale = new Scale(parsePitchClass('A'), 'aeolian');

  it.each(PROGRESSION_STYLES.map((s) => s.id))('%s: starts on the tonic, never repeats a chord, ends away from home', (style) => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = generateProgression(scale, style, new Rng(seed));
      expect(p[0]!.degree).toBe(0);
      expect(p.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < p.length; i++) expect(p[i]!.degree).not.toBe(p[i - 1]!.degree);
      expect(p[p.length - 1]!.degree).not.toBe(0);
      expect(p.every((s) => s.bars > 0)).toBe(true);
    }
  });

  it('avoids diminished chords outside jazzy', () => {
    let dim = 0;
    for (let seed = 1; seed <= 100; seed++) {
      for (const st of generateProgression(scale, 'pop', new Rng(seed))) {
        if (/dim/.test(Chord.fromDegree(scale, st.degree, 3).symbol())) dim++;
      }
    }
    expect(dim).toBe(0);
  });

  it('vary keeps the first chord and changes at most one other', () => {
    const p = generateProgression(scale, 'house', new Rng(3), 4);
    for (let seed = 1; seed < 30; seed++) {
      const v = varyProgression(p, scale, 'house', new Rng(seed));
      expect(v[0]!.degree).toBe(p[0]!.degree);
      expect(v.filter((s, i) => s.degree !== p[i]!.degree).length).toBeLessThanOrEqual(1);
    }
  });
});

describe('step conditions and ratchets', () => {
  it('1:2 plays on odd passes, 4:4 on every 4th', () => {
    expect([0, 1, 2, 3].map((p) => conditionMet({ on: 1, every: 2 }, p))).toEqual([true, false, true, false]);
    expect([0, 1, 2, 3, 7].map((p) => conditionMet({ on: 4, every: 4 }, p))).toEqual([false, false, false, true, true]);
  });

  it('cycles conditions and ratchets on a hit', () => {
    let p: Pattern = { lengthSteps: 16, events: [{ step: 0, length: 0.5, velocity: 100, pitch: { kind: 'fixed', note: 36 } }] };
    p = cycleCondition(p, drumAt(0, 36));
    expect(p.events[0]!.condition).toEqual({ on: 1, every: 2 });
    for (let i = 0; i < 6; i++) p = cycleCondition(p, drumAt(0, 36));
    expect(p.events[0]!.condition).toBeUndefined();
    p = cycleRatchet(cycleRatchet(p, drumAt(0, 36)), drumAt(0, 36));
    expect(p.events[0]!.ratchet).toBe(3);
  });

  it('engine honours conditions and plays ratchets as repeated notes', () => {
    const timer = new FakeTimer();
    const project = createProject('techno');
    const drums = project.tracks.find((t) => t.generator.type === 'drums')!;
    const userPattern: Pattern = {
      lengthSteps: 16,
      events: [
        { step: 0, length: 0.5, velocity: 100, pitch: { kind: 'fixed', note: 36 }, condition: { on: 1, every: 2 } },
        { step: 8, length: 0.5, velocity: 100, pitch: { kind: 'fixed', note: 42 }, ratchet: 3 },
      ],
    };
    const tr8s = new RecordingOutput('TR-8S');
    const seq = new Sequencer(
      { ...project, bpm: 120, tracks: [{ ...drums, userPattern, frozen: true }] },
      new StaticPortResolver([tr8s]),
      timer,
    );
    seq.start();
    runUntil(seq, timer, 7800); // just under 4 bars at 120 bpm
    seq.stop();
    const ons = (note: number) => tr8s.sent.filter((m) => m.data[0] === 0x99 && m.data[1] === note).length;
    expect(ons(36)).toBe(2); // passes 1 and 3 of 4
    expect(ons(42)).toBe(4 * 3); // 3 repeats every bar
  });
});

describe('call and response', () => {
  it('alternates phrases', () => {
    const call = { role: 'call' as const, bars: 2 };
    const resp = { role: 'response' as const, bars: 2 };
    expect([0, 1, 2, 3, 4].map((b) => phraseActive(call, b))).toEqual([true, true, false, false, true]);
    expect([0, 1, 2, 3, 4].map((b) => phraseActive(resp, b))).toEqual([false, false, true, true, false]);
  });

  it('answers with the call transformed, one phrase later', () => {
    const source: Pattern = {
      lengthSteps: 16,
      events: [
        { step: 0, length: 1, velocity: 90, pitch: { kind: 'degree', degree: 0 } },
        { step: 4, length: 1, velocity: 90, pitch: { kind: 'degree', degree: 2 } },
      ],
    };
    expect(answerEvents(source, 'upThird', 4, 16, 1)).toEqual([]); // still the call phrase
    expect(answerEvents(source, 'upThird', 16 + 4, 16, 1)[0]!.pitch).toEqual({ kind: 'degree', degree: 4 });
    expect(answerEvents(source, 'invert', 16 + 4, 16, 1)[0]!.pitch).toEqual({ kind: 'degree', degree: -2 });
    expect(answerEvents(source, 'retrograde', 16 + 15, 16, 1)[0]!.step).toBe(0);
    expect(transformPitch({ kind: 'fixed', note: 36 }, 'invert')).toEqual({ kind: 'fixed', note: 36 });
  });

  it('the Conversation template takes turns on the same synth', () => {
    const timer = new FakeTimer();
    const project = createProject('conversation');
    const lead = new RecordingOutput('Lead synth');
    const seq = new Sequencer(project, new StaticPortResolver([lead, new RecordingOutput('Bass synth'), new RecordingOutput('TR-8S')]), timer);
    const byBar: Record<string, Set<number>> = {};
    let bar = 0;
    seq.events.on('step', (e) => (bar = e.bar));
    seq.events.on('note', (n) => {
      const name = project.tracks.find((t) => t.id === n.trackId)!.name;
      (byBar[name] ??= new Set()).add(bar);
    });
    seq.start();
    runUntil(seq, timer, 8 * 2034); // ~8 bars at 118 bpm
    seq.stop();
    for (const b of byBar.Call ?? []) expect(b % 2).toBe(0);
    for (const b of byBar.Answer ?? []) expect(b % 2).toBe(1);
    expect(byBar.Answer?.size).toBeGreaterThan(0);
  });
});

describe('evolving harmony', () => {
  it('a progression changed at the loop point starts from its first chord', () => {
    const timer = new FakeTimer();
    const project = createProject('techno'); // 4-bar progression
    const seq = new Sequencer(project, new StaticPortResolver([]), timer);
    const chords: string[] = [];
    seq.events.on('loop', () => {
      seq.update({ ...seq.state, progression: [{ degree: 5, bars: 2 }, { degree: 3, bars: 3 }] });
    });
    seq.events.on('chord', (c) => chords.push(c.chord.symbol()));
    seq.start();
    runUntil(seq, timer, 9 * 1846); // ~9 bars at 130 bpm
    seq.stop();
    // Bars 0–3: original (A phrygian: Am, Bb, Gm); bar 4: new progression starts on degree 5 (F)
    expect(chords.slice(0, 3)).toEqual(['Am', 'A#', 'Gm']);
    expect(chords[3]).toBe('F');
  });
});
