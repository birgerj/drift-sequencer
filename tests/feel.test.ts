import { describe, expect, it } from 'vitest';
import { LookaheadScheduler, type TimerHost } from '../src/core/engine/scheduler';
import { Sequencer } from '../src/core/engine/sequencer';
import { TrackRuntime } from '../src/core/engine/trackRuntime';
import type { Pattern } from '../src/core/pattern/pattern';
import { RecordingOutput, StaticPortResolver } from '../src/io/midi/output';
import type { ProjectState, TrackState } from '../src/state/project';
import { createProject } from '../src/state/templates';

class FakeTimer implements TimerHost {
  time = 0;
  now = () => this.time;
  setInterval = () => 1;
  clearInterval = () => {};
}

const steps = (list: number[], note: number, vel = 90): Pattern => ({
  lengthSteps: 16,
  events: list.map((step) => ({ step, length: 1, velocity: vel, pitch: { kind: 'fixed' as const, note } })),
});

/** Run a project for `ms` and return note-ons per port. */
function run(project: ProjectState, ms = 1000) {
  const timer = new FakeTimer();
  const outs = ['B', 'D'].map((n) => new RecordingOutput(n));
  const seq = new Sequencer(project, new StaticPortResolver(outs), timer);
  seq.start();
  const sched = (seq as unknown as { scheduler: LookaheadScheduler }).scheduler;
  while (timer.time < ms) {
    timer.time += 25;
    sched.tick();
  }
  seq.stop();
  const ons = (o: RecordingOutput) => o.sent.filter((m) => (m.data[0]! & 0xf0) === 0x90 && m.data[2]! > 0);
  return { bass: ons(outs[0]!), drums: ons(outs[1]!) };
}

function project(bass: Partial<TrackState>, kicks: number[] = []): ProjectState {
  const p = createProject('techno');
  const b = p.tracks.find((t) => t.generator.type === 'bass')!;
  const d = p.tracks.find((t) => t.generator.type === 'drums')!;
  return {
    ...p,
    bpm: 120,
    tracks: [
      { ...b, output: { portName: 'B', channel: 2 }, modulations: [], frozen: true, userPattern: steps([0, 4, 8, 12], 40), ...bass },
      { ...d, output: { portName: 'D', channel: 10 }, modulations: [], frozen: true, userPattern: steps(kicks, 36) },
    ],
  };
}

describe('humanize', () => {
  it('lays notes back and never plays them before their step', () => {
    const plain = run(project({}));
    const late = run(project({ humanize: { timing: 0, velocity: 0, layBack: 1 } }));
    expect(late.bass[0]!.timestamp! - plain.bass[0]!.timestamp!).toBeCloseTo(25, 0);
    const drift = run(project({ humanize: { timing: 1, velocity: 1, layBack: 0 } }));
    const t0 = plain.bass.map((m) => m.timestamp!);
    drift.bass.forEach((m, i) => expect(m.timestamp!).toBeGreaterThanOrEqual(t0[i]! - 0.001));
    expect(new Set(drift.bass.map((m) => m.data[2])).size).toBeGreaterThan(1);
  });
});

describe('bass and kick', () => {
  it('make room: a bass note on a kick moves to the next step', () => {
    const plain = run(project({}, [0, 8]), 2200);
    const room = run(project({ kickMode: 'avoid' }, [0, 8]), 2200);
    const step = 125;
    const rel = (xs: { timestamp?: number }[], base: number) => xs.slice(0, 4).map((m) => Math.round(m.timestamp! - base));
    const base = plain.bass[0]!.timestamp!;
    expect(rel(plain.bass, base)).toEqual([0, 4 * step, 8 * step, 12 * step]);
    expect(rel(room.bass, base)).toEqual([step, 4 * step, 9 * step, 12 * step]);
  });

  it('duck: a bass note on a kick plays softer', () => {
    const duck = run(project({ kickMode: 'duck' }, [0]));
    expect(duck.bass[0]!.data[2]).toBeLessThan(60);
    expect(duck.bass[1]!.data[2]).toBe(90);
  });
});

describe('melody memory', () => {
  it('returns to the theme after the set number of changes', () => {
    const p = createProject('techno');
    const lead = { ...p.tracks[0]!, frozen: false, mutationIntervalBars: 1, memory: { every: 2, mode: 'theme' as const } };
    const rt = new TrackRuntime(lead, 16);
    const theme = rt.theme;
    rt.maybeMutate(1);
    rt.maybeMutate(2);
    expect(rt.maybeMutate(3)).toBe(true);
    expect(rt.lastChange).toBe('theme');
    expect(rt.pattern).toBe(theme);
  });
});
