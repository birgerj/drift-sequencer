import { describe, expect, it } from 'vitest';
import { LookaheadScheduler, type TimerHost } from '../src/core/engine/scheduler';
import { Sequencer } from '../src/core/engine/sequencer';
import { defaultConfig, generatePattern } from '../src/core/generators/registry';
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

/** Note-on timestamps for a one-track project with a 4-step pattern of 16ths. */
function noteTimes(rate: number, ms = 1000): number[] {
  const timer = new FakeTimer();
  const project = createProject('techno');
  const lead = project.tracks[0]!;
  const userPattern: Pattern = {
    lengthSteps: 16,
    events: [0, 1, 2, 3].map((step) => ({ step, length: 1, velocity: 90, pitch: { kind: 'degree' as const, degree: 0 } })),
  };
  const out = new RecordingOutput('X');
  const seq = new Sequencer(
    { ...project, bpm: 120, tracks: [{ ...lead, rate, output: { portName: 'X', channel: 1 }, modulations: [], userPattern, frozen: true }] },
    new StaticPortResolver([out]),
    timer,
  );
  seq.start();
  const sched = (seq as unknown as { scheduler: LookaheadScheduler }).scheduler;
  while (timer.time < ms) {
    timer.time += 25;
    sched.tick();
  }
  seq.stop();
  const ons = out.sent.filter((m) => m.data[0] === 0x90).map((m) => m.timestamp!);
  return ons.map((t) => Math.round(t - ons[0]!));
}

describe('track speed', () => {
  it('×1 plays one step per 16th (125 ms at 120 bpm)', () => {
    expect(noteTimes(1).slice(0, 4)).toEqual([0, 125, 250, 375]);
  });
  it('½ plays each step twice as long', () => {
    expect(noteTimes(0.5).slice(0, 4)).toEqual([0, 250, 500, 750]);
  });
  it('¼ plays each step four times as long', () => {
    expect(noteTimes(0.25, 2000).slice(0, 4)).toEqual([0, 500, 1000, 1500]);
  });
  it('×2 plays two steps per 16th', () => {
    expect(noteTimes(2).slice(0, 4)).toEqual([0, 63, 125, 188]);
  });
});

describe('track length', () => {
  it('changing the length keeps the pattern (repeats it) instead of regenerating', () => {
    const project = createProject('deep-house');
    const seq = new Sequencer(project, new StaticPortResolver([]));
    const lead = project.tracks[0]!;
    const before = seq.track(lead.id)!.pattern;
    const next = {
      ...project,
      tracks: project.tracks.map((t) =>
        t.id === lead.id ? { ...t, generator: { ...t.generator, params: { ...t.generator.params, lengthSteps: 64 } } as typeof t.generator } : t,
      ),
    };
    seq.update(next);
    const after = seq.track(lead.id)!.pattern;
    expect(after.lengthSteps).toBe(64);
    expect(after.events.filter((e) => e.step < before.lengthSteps)).toEqual(before.events);
  });

  it('generators make 8-step and 64-step patterns of the right length', () => {
    for (const type of ['motif', 'bass', 'acid', 'arp', 'chords', 'drone', 'drums'] as const) {
      for (const lengthSteps of [8, 64]) {
        const base = defaultConfig(type);
        const config = { ...base, params: { ...base.params, lengthSteps } } as typeof base;
        const p = generatePattern(config, { rng: new Rng(1), stepsPerBar: 16 });
        expect(p.lengthSteps, `${type} ${lengthSteps}`).toBe(lengthSteps);
        for (const e of p.events) expect(e.step).toBeLessThan(lengthSteps);
      }
    }
  });
});
