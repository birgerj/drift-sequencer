import { describe, expect, it } from 'vitest';
import { LookaheadScheduler, type TimerHost } from '../src/core/engine/scheduler';
import { Sequencer } from '../src/core/engine/sequencer';
import { RecordingOutput, StaticPortResolver } from '../src/io/midi/output';
import { inputForDevice, type RackDevice } from '../src/state/rack';
import { createProject } from '../src/state/templates';

const dev = (portName: string, inputName?: string): RackDevice => ({ id: 'd', name: 'd', portName, channel: 1, roles: [], clock: false, inputName });

describe('device input matching', () => {
  it('uses the input with the same name, or the only one sharing the first word', () => {
    expect(inputForDevice(dev('HYDRASYNTH DR'), ['HYDRASYNTH DR', 'TB-03'])).toBe('HYDRASYNTH DR');
    expect(inputForDevice(dev('wavestate SOUND'), ['wavestate KBD', 'TR-8S'])).toBe('wavestate KBD');
    expect(inputForDevice(dev('USB MIDI 1'), ['USB MIDI 2', 'USB MIDI 3'])).toBeUndefined();
    expect(inputForDevice(dev('TB-03', 'off'), ['TB-03'])).toBeUndefined();
    expect(inputForDevice(dev('TB-03', 'Other'), ['TB-03', 'Other'])).toBe('Other');
  });
});

class FakeTimer implements TimerHost {
  time = 0;
  now = () => this.time;
  setInterval = () => 1;
  clearInterval = () => {};
}

function ccs(motionValues: number[], hold: boolean) {
  const p = createProject('techno');
  const lead = p.tracks[0]!;
  const out = new RecordingOutput('L');
  const timer = new FakeTimer();
  const project = {
    ...p,
    bpm: 120,
    tracks: [
      {
        ...lead,
        output: { portName: 'L', channel: 1 },
        modulations: [{ id: 'm', enabled: true, cc: 71, label: 'Res', shape: 'sine' as const, periodBars: 1, min: 0, max: 127 }],
        motions: [{ id: 'x', cc: 74, label: 'Cutoff', enabled: true, values: motionValues }],
      },
    ],
  };
  const seq = new Sequencer(project, new StaticPortResolver([out]), timer);
  if (hold) {
    seq.holdCc(lead.id, 71, 10_000);
    seq.holdCc(lead.id, 74, 10_000);
  }
  seq.start();
  const sched = (seq as unknown as { scheduler: LookaheadScheduler }).scheduler;
  while (timer.time < 1300) {
    timer.time += 25;
    sched.tick();
  }
  seq.stop();
  return out.sent.filter((m) => (m.data[0]! & 0xf0) === 0xb0 && (m.data[1] === 74 || m.data[1] === 71)).map((m) => [m.data[1], m.data[2]]);
}

describe('recorded motions', () => {
  it('play their values, sending only changes', () => {
    const values = [0, 0, 0, 0, 40, 40, 40, 40, 80, 80, 80, 80, 120, 120, 120, 120];
    const sent = ccs(values, false).filter(([cc]) => cc === 74).map(([, v]) => v);
    expect(sent.slice(0, 3)).toEqual([0, 40, 80]);
  });

  it('pause while a knob is held by hand', () => {
    expect(ccs([0, 64, 127, 64], true)).toEqual([]);
  });
});
