import { describe, expect, it } from 'vitest';
import { LookaheadScheduler, type TimerHost } from '../src/core/engine/scheduler';
import { Sequencer } from '../src/core/engine/sequencer';
import { slideHold } from '../src/core/engine/trackRuntime';
import { AcidGenerator } from '../src/core/generators/acidGenerator';
import { setAcidNote, toggleAcidFlag } from '../src/core/pattern/edit';
import type { Pattern } from '../src/core/pattern/pattern';
import { Rng } from '../src/core/random/rng';
import { RecordingOutput, StaticPortResolver } from '../src/io/midi/output';
import { createProject } from '../src/state/templates';

class FakeTimer implements TimerHost {
  time = 0;
  now = () => this.time;
  setInterval = () => 1;
  clearInterval = () => {};
}

describe('acid generator', () => {
  const gen = new AcidGenerator();
  it('makes 303-style lines: root on 1, accents, slides only after notes, 303 gate', () => {
    for (let seed = 1; seed < 30; seed++) {
      const p = gen.generate(gen.defaults(), { rng: new Rng(seed), stepsPerBar: 16 });
      expect(p.events[0]).toMatchObject({ step: 0, pitch: { kind: 'degree', degree: 0, octave: 0 } });
      const steps = new Set(p.events.map((e) => e.step));
      for (const e of p.events) {
        if (e.slide) expect(steps.has(e.step - 1)).toBe(true);
        expect(e.length).toBeCloseTo(0.58);
      }
    }
    const all = Array.from({ length: 30 }, (_, i) => gen.generate(gen.defaults(), { rng: new Rng(i), stepsPerBar: 16 }).events).flat();
    expect(all.some((e) => e.accent)).toBe(true);
    expect(all.some((e) => e.slide)).toBe(true);
    expect(all.some((e) => e.pitch.kind === 'degree' && e.pitch.octave === 1)).toBe(true);
  });

  it('mutation keeps slides valid', () => {
    let p = gen.generate(gen.defaults(), { rng: new Rng(3), stepsPerBar: 16 });
    for (let i = 0; i < 50; i++) {
      p = gen.mutate(p, { ...gen.defaults(), mutation: 0.5 }, { rng: new Rng(i), stepsPerBar: 16 });
      const steps = new Set(p.events.map((e) => e.step));
      for (const e of p.events) if (e.slide && e.step > 0) expect(steps.has(e.step - 1)).toBe(true);
    }
  });
});

describe('acid editing', () => {
  const empty: Pattern = { lengthSteps: 16, events: [] };
  it('sets notes, rests and flags', () => {
    let p = setAcidNote(empty, 0, 0, { gate: 0.58, velocity: 88 });
    p = setAcidNote(p, 1, 4, { gate: 0.58, velocity: 88 });
    p = toggleAcidFlag(p, 1, 'slide');
    p = toggleAcidFlag(p, 1, 'up');
    p = toggleAcidFlag(p, 1, 'accent');
    expect(p.events[1]).toMatchObject({ slide: true, accent: true, pitch: { degree: 4, octave: 1 } });
    p = setAcidNote(p, 1, 2, { gate: 0.58, velocity: 88 }); // change note, keep flags
    expect(p.events[1]).toMatchObject({ slide: true, pitch: { degree: 2, octave: 1 } });
    p = setAcidNote(p, 0, 0, { gate: 0.58, velocity: 88 }); // step 0 becomes a rest → step 1 can't slide
    expect(p.events).toHaveLength(1);
    expect(p.events[0]!.slide).toBe(false);
  });

  it('holds a note into the next one when that one slides', () => {
    const p: Pattern = {
      lengthSteps: 16,
      events: [
        { step: 0, length: 0.58, velocity: 88, pitch: { kind: 'degree', degree: 0 } },
        { step: 2, length: 0.58, velocity: 88, pitch: { kind: 'degree', degree: 4 }, slide: true },
        { step: 5, length: 0.58, velocity: 88, pitch: { kind: 'degree', degree: 0 } },
      ],
    };
    expect(slideHold(p, p.events[0]!)).toBe(2);
    expect(slideHold(p, p.events[1]!)).toBeUndefined();
  });
});

describe('acid in the engine', () => {
  it('overlaps notes for slides, sends slide CC, accents at full velocity', () => {
    const timer = new FakeTimer();
    const project = createProject('acid');
    const acid = project.tracks.find((t) => t.generator.type === 'acid')!;
    const userPattern: Pattern = {
      lengthSteps: 16,
      events: [
        { step: 0, length: 0.58, velocity: 88, pitch: { kind: 'degree', degree: 0 }, accent: true },
        { step: 1, length: 0.58, velocity: 88, pitch: { kind: 'degree', degree: 0, octave: 1 }, slide: true },
      ],
    };
    const out = new RecordingOutput('TD');
    const seq = new Sequencer(
      { ...project, bpm: 120, tracks: [{ ...acid, output: { portName: 'TD', channel: 1 }, slideCc: 102, modulations: [], userPattern, frozen: true }] },
      new StaticPortResolver([out]),
      timer,
    );
    seq.start();
    const sched = (seq as unknown as { scheduler: LookaheadScheduler }).scheduler;
    for (let t = 25; t <= 400; t += 25) {
      timer.time = t;
      sched.tick();
    }
    seq.stop();
    const ons = out.sent.filter((m) => m.data[0] === 0x90);
    const offs = out.sent.filter((m) => m.data[0] === 0x80);
    expect(ons[0]!.data[2]).toBe(127); // accent
    expect(ons[1]!.data[2]).toBe(88);
    // first note's off comes after the second note's on → overlap → slide
    const firstOff = offs.find((m) => m.data[1] === ons[0]!.data[1])!;
    expect(firstOff.timestamp!).toBeGreaterThan(ons[1]!.timestamp!);
    expect(ons[1]!.data[1]! - ons[0]!.data[1]!).toBe(12);
    const slideCcs = out.sent.filter((m) => m.data[0] === 0xb0 && m.data[1] === 102).map((m) => m.data[2]);
    expect(slideCcs.slice(0, 2)).toEqual([0, 127]);
  });
});
