import { describe, expect, it } from 'vitest';
import { LookaheadScheduler, type TimerHost } from '../src/core/engine/scheduler';
import { Sequencer } from '../src/core/engine/sequencer';
import { MidiGuard } from '../src/io/midi/guard';
import { RecordingOutput, StaticPortResolver } from '../src/io/midi/output';
import { createProject, TEMPLATES } from '../src/state/templates';

class FakeTimer implements TimerHost {
  time = 0;
  now = () => this.time;
  setInterval = () => 1;
  clearInterval = () => {};
}
const schedulerOf = (seq: Sequencer) => (seq as unknown as { scheduler: LookaheadScheduler }).scheduler;
const ports = () => ['Lead synth', 'Bass synth', 'TR-8S'].map((n) => new RecordingOutput(n));

describe('stability', () => {
  it('after the browser pauses for 10 minutes, it skips ahead instead of replaying every step', () => {
    const timer = new FakeTimer();
    const outs = ports();
    const seq = new Sequencer(createProject('deep-house'), new StaticPortResolver(outs), timer);
    const skipped: number[] = [];
    seq.events.on('skipped', (e) => skipped.push(e.steps));
    seq.start();
    timer.time = 10 * 60 * 1000;
    schedulerOf(seq).tick();
    const sent = outs.reduce((s, o) => s + o.sent.length, 0);
    expect(skipped[0]).toBeGreaterThan(4000);
    expect(sent).toBeLessThan(300);
    expect(seq.playing).toBe(true);
    seq.stop();
  });

  it('keeps the musical position when skipping', () => {
    const timer = new FakeTimer();
    const s = new LookaheadScheduler({ bpm: 120, lookaheadMs: 100 }, timer);
    const steps: number[] = [];
    s.start((step) => steps.push(step), 0);
    timer.time = 10_000; // 80 steps of 125 ms later
    s.tick();
    expect(steps[steps.length - 1]).toBeGreaterThanOrEqual(80);
    expect(steps.length).toBeLessThan(5);
  });

  it.each(TEMPLATES.map((t) => t.id))('%s: steady message rate and no growth over 5 minutes', (id) => {
    const timer = new FakeTimer();
    const outs = ports();
    const p = createProject(id);
    const project = {
      ...p,
      harmonyEvolve: { enabled: true, style: 'house' as const, everyLoops: 1, mode: 'new' as const },
      tracks: p.tracks.map((t) => ({
        ...t,
        mutationIntervalBars: 1,
        modulations: [{ id: 'l', enabled: true, cc: 74, label: 'c', shape: 'sine' as const, periodBars: 2, min: 0, max: 127 }],
      })),
    };
    const seq = new Sequencer(project, new StaticPortResolver(outs), timer);
    seq.start();
    const perMinute: number[] = [];
    for (let m = 0; m < 5; m++) {
      for (let ms = 0; ms < 60000; ms += 25) {
        timer.time += 25;
        schedulerOf(seq).tick();
      }
      perMinute.push(outs.reduce((s, o) => s + o.sent.length, 0));
      outs.forEach((o) => (o.sent.length = 0));
    }
    expect(seq.playing).toBe(true); // the safety valve never tripped
    expect(Math.max(...perMinute)).toBeLessThan(20000);
    expect(Math.max(...perMinute) / Math.min(...perMinute)).toBeLessThan(1.5);
    const rts = [...(seq as unknown as { tracks: Map<string, { history: unknown[] }> }).tracks.values()];
    for (const rt of rts) expect(rt.history.length).toBeLessThanOrEqual(64);
    seq.stop();
  });

  it('the MIDI guard drops stale messages and stops a flood', () => {
    let now = 1000;
    let trips = 0;
    const out = new RecordingOutput('x');
    const guard = new MidiGuard(new StaticPortResolver([out]), { now: () => now, maxPerSecond: 100, onTrip: () => trips++ });
    const port = guard.byName('x')!;
    port.send([0x90, 60, 100], now - 5000); // stale
    expect(out.sent).toHaveLength(0);
    for (let i = 0; i < 150; i++) port.send([0x90, 60, 100], now);
    expect(trips).toBe(1);
    expect(out.sent.length).toBe(100);
    port.send([0xb0, 123, 0]); // all notes off still passes
    port.send([0xfc]);
    expect(out.sent.length).toBe(102);
    guard.reset();
    now += 2000;
    port.send([0x90, 60, 100], now);
    expect(out.sent.length).toBe(103);
  });
});
