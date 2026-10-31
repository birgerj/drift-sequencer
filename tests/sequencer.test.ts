import { describe, expect, it } from 'vitest';
import { LookaheadScheduler, type TimerHost } from '../src/core/engine/scheduler';
import { Sequencer } from '../src/core/engine/sequencer';
import { RecordingOutput, StaticPortResolver } from '../src/io/midi/output';
import { deserializeProject, MemoryProjectRepository, serializeProject } from '../src/state/storage';
import { createProject, TEMPLATES } from '../src/state/templates';

class FakeTimer implements TimerHost {
  time = 0;
  now = () => this.time;
  setInterval = () => 1;
  clearInterval = () => {};
}

describe('LookaheadScheduler', () => {
  it('schedules steps with exact timestamps inside the lookahead window', () => {
    const timer = new FakeTimer();
    const s = new LookaheadScheduler({ bpm: 120, lookaheadMs: 100 }, timer);
    const steps: [number, number][] = [];
    s.start((step, t) => steps.push([step, t]), 0);
    timer.time = 400;
    s.tick();
    // 120 bpm, 16ths = 125 ms per step; window ends at 500 ms.
    expect(steps).toEqual([
      [0, 0],
      [1, 125],
      [2, 250],
      [3, 375],
    ]);
  });

  it('applies swing to odd steps', () => {
    const timer = new FakeTimer();
    const s = new LookaheadScheduler({ bpm: 120, swing: 0.5, lookaheadMs: 200 }, timer);
    const times: number[] = [];
    s.start((_, t) => times.push(t), 0);
    expect(times[1]).toBeCloseTo(125 + 0.5 * 125 * 0.5);
  });
});

describe('Sequencer', () => {
  it('sends notes, clock and start/stop to the right ports and channels', () => {
    const timer = new FakeTimer();
    const project = createProject('deep-house');
    const ports = ['Lead synth', 'Bass synth', 'TR-8S'].map((n) => new RecordingOutput(n));
    const seq = new Sequencer(project, new StaticPortResolver(ports), timer);
    const notes: number[] = [];
    seq.events.on('note', (n) => notes.push(...n.notes));

    seq.start();
    timer.time = 4000; // two bars at 122 bpm
    (seq as unknown as { scheduler: LookaheadScheduler }).scheduler.tick();
    seq.stop();

    const tr8s = ports[2]!.sent.map((m) => m.data[0]);
    expect(tr8s[0]).toBe(0xfa); // start
    expect(tr8s).toContain(0xf8); // clock
    expect(tr8s).toContain(0x99); // note on, channel 10
    expect(tr8s[tr8s.length - 2]).toBe(0xfc); // stop, then all-notes-off
    const bass = ports[1]!.sent.map((m) => m.data[0]);
    expect(bass).toContain(0x91); // note on, channel 2
    expect(notes.length).toBeGreaterThan(10);
  });
});

describe('storage', () => {
  it('round-trips every template through JSON', async () => {
    const repo = new MemoryProjectRepository();
    for (const t of TEMPLATES) {
      const p = createProject(t.id);
      expect(deserializeProject(serializeProject(p))).toEqual(p);
      await repo.save(p);
    }
    expect(await repo.list()).toHaveLength(TEMPLATES.length);
  });

  it('rejects broken files', () => {
    expect(() => deserializeProject('{"bpm": 999}')).toThrow(/Invalid project/);
    expect(() => deserializeProject('{"schemaVersion": 99}')).toThrow(/newer version/);
  });
});
