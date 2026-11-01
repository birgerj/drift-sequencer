import { describe, expect, it } from 'vitest';
import { applyInterplay, avoidPitchClasses, interplayActive, type InterplaySettings } from '../src/core/engine/interplay';
import type { LookaheadScheduler, TimerHost } from '../src/core/engine/scheduler';
import { Sequencer } from '../src/core/engine/sequencer';
import type { ScheduledNote } from '../src/core/engine/trackRuntime';
import type { Pattern } from '../src/core/pattern/pattern';
import { Rng } from '../src/core/random/rng';
import { Chord } from '../src/core/theory/chord';
import { Scale } from '../src/core/theory/scale';
import { RecordingOutput, StaticPortResolver } from '../src/io/midi/output';
import type { ProjectState, TrackState } from '../src/state/project';
import { createProject } from '../src/state/templates';

const note = (notes: number[], offset = 0): ScheduledNote => ({
  trackId: 't',
  notes,
  velocity: 90,
  length: 1,
  ratchet: 1,
  accent: false,
  slide: false,
  offset,
  stepScale: 1,
});

// C major triad: C E G.
const C = Chord.fromDegree(new Scale(0, 'ionian'), 0, 3);
const ctx = (strong = true) => ({ strong, chord: C, rng: new Rng(1), fixed: false, low: 36, high: 84 });
const rules = (patch: Partial<InterplaySettings>): InterplaySettings => ({ listenTo: ['x'], rhythm: 'free', otherTone: false, amount: 1, ...patch });

describe('interplay rules', () => {
  it('is inactive without partners or rules', () => {
    expect(interplayActive(undefined)).toBe(false);
    expect(interplayActive(rules({ listenTo: [] , rhythm: 'space' }))).toBe(false);
    expect(interplayActive(rules({ rhythm: 'free', otherTone: false }))).toBe(false);
    expect(interplayActive(rules({ rhythm: 'space' }))).toBe(true);
  });

  it('space: rests where the other track plays', () => {
    expect(applyInterplay([note([48])], [note([72])], rules({ rhythm: 'space' }), ctx())).toEqual([]);
    expect(applyInterplay([note([48])], [], rules({ rhythm: 'space' }), ctx())).toHaveLength(1);
  });

  it('lock: plays only together with the other track, a little louder', () => {
    expect(applyInterplay([note([48])], [], rules({ rhythm: 'lock' }), ctx())).toEqual([]);
    const together = applyInterplay([note([48])], [note([36])], rules({ rhythm: 'lock' }), ctx());
    expect(together[0]!.velocity).toBeGreaterThan(90);
  });

  it('other tone: moves off a pitch class the other track plays, to a free chord tone', () => {
    const out = applyInterplay([note([60])], [note([48])], rules({ otherTone: true }), ctx());
    expect(out[0]!.notes).toEqual([64]); // C was taken → E above
    // Weak steps are left alone.
    expect(applyInterplay([note([60])], [note([48])], rules({ otherTone: true }), ctx(false))[0]!.notes).toEqual([60]);
  });

  it('other tone: a chord drops doubled tones but keeps at least two', () => {
    expect(avoidPitchClasses(note([60, 64, 67]), new Set([0]), C, 36, 84).notes).toEqual([64, 67]);
    expect(avoidPitchClasses(note([60, 64]), new Set([0]), C, 36, 84).notes).toEqual([60, 64]);
  });

  it('amount 0 changes nothing', () => {
    const own = [note([60])];
    expect(applyInterplay(own, [note([48])], rules({ rhythm: 'space', otherTone: true, amount: 0 }), ctx())).toEqual(own);
  });
});

class FakeTimer implements TimerHost {
  time = 0;
  now = () => this.time;
  setInterval = () => 1;
  clearInterval = () => {};
}

const pattern = (list: number[], pitch: number): Pattern => ({
  lengthSteps: 16,
  events: list.map((step) => ({ step, length: 1, velocity: 90, pitch: { kind: 'fixed' as const, note: pitch } })),
});

function run(lead: Partial<TrackState>, bass: Partial<TrackState>) {
  const p = createProject('techno');
  const b = p.tracks.find((t) => t.generator.type === 'bass')!;
  const project: ProjectState = {
    ...p,
    bpm: 120,
    tracks: [
      { ...b, id: 'lead', output: { portName: 'L', channel: 1 }, modulations: [], frozen: true, ...lead },
      { ...b, id: 'bass', output: { portName: 'B', channel: 2 }, modulations: [], frozen: true, ...bass },
    ],
  };
  const timer = new FakeTimer();
  const outs = ['L', 'B'].map((n) => new RecordingOutput(n));
  const seq = new Sequencer(project, new StaticPortResolver(outs), timer);
  seq.start();
  const sched = (seq as unknown as { scheduler: LookaheadScheduler }).scheduler;
  while (timer.time < 1900) {
    timer.time += 25;
    sched.tick();
  }
  seq.stop();
  const times = (o: RecordingOutput) => o.sent.filter((m) => (m.data[0]! & 0xf0) === 0x90 && m.data[2]! > 0).map((m) => Math.round(m.timestamp!));
  return { lead: times(outs[0]!), bass: times(outs[1]!) };
}

describe('interplay in the sequencer', () => {
  it('a bass that makes room never starts on a lead note', () => {
    const lead = { userPattern: pattern([0, 3, 6, 10], 72) };
    const bass = { userPattern: pattern([0, 2, 4, 6, 8, 10, 12, 14], 40) };
    const free = run(lead, bass);
    expect(free.bass.some((t) => free.lead.includes(t))).toBe(true);
    const room = run(lead, { ...bass, interplay: { listenTo: ['lead'], rhythm: 'space', otherTone: false, amount: 1 } });
    expect(room.bass.length).toBeGreaterThan(0);
    expect(room.bass.some((t) => room.lead.includes(t))).toBe(false);
  });

  it('a muted partner is not heard', () => {
    const lead = { userPattern: pattern([0, 4, 8, 12], 72), muted: true };
    const bass = { userPattern: pattern([0, 4, 8, 12], 40), interplay: { listenTo: ['lead'], rhythm: 'space' as const, otherTone: false, amount: 1 } };
    expect(run(lead, bass).bass).toEqual(run(lead, { userPattern: bass.userPattern }).bass);
  });
});
