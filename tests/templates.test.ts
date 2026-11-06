import { describe, expect, it } from 'vitest';
import { LookaheadScheduler, type TimerHost } from '../src/core/engine/scheduler';
import { Sequencer } from '../src/core/engine/sequencer';
import { Scale } from '../src/core/theory/scale';
import { RecordingOutput, StaticPortResolver } from '../src/io/midi/output';
import { LOCAL_PORTS } from '../src/io/local/ports';
import { BUILT_IN_INSTRUMENTS } from '../src/state/instrumentLibrary';
import { drumPattern, drumVoices, line } from '../src/state/notation';
import { assignBestFit, assignDevices, newDevice, resolveProject, type Rack } from '../src/state/rack';
import { createProject, templateSounds, TEMPLATES } from '../src/state/templates';

class FakeTimer implements TimerHost {
  time = 0;
  now = () => this.time;
  setInterval = () => 1;
  clearInterval = () => {};
}

/** Play a template for `bars` bars, each track on its own port. */
function play(templateId: string, bars: number) {
  const project = createProject(templateId);
  const tracks = project.tracks.map((t, i) => ({ ...t, output: { portName: `T${i}`, channel: 1 } }));
  const outs = tracks.map((t) => new RecordingOutput(t.output.portName));
  const timer = new FakeTimer();
  const seq = new Sequencer({ ...project, tracks, harmonyEvolve: undefined }, new StaticPortResolver(outs), timer);
  const sched = (seq as unknown as { scheduler: LookaheadScheduler }).scheduler;
  seq.start();
  const until = (bars * 4 * 60000) / project.bpm;
  while (timer.time < until) {
    timer.time += 25;
    sched.tick();
  }
  seq.stop();
  const notes = outs.map((o) => o.sent.filter((m) => (m.data[0]! & 0xf0) === 0x90 && m.data[2]! > 0).map((m) => m.data[1]!));
  return { project, tracks, notes };
}

describe('notation', () => {
  it('reads lines: ties, accents, slides, octaves and chords', () => {
    const p = line("!0 - ~2' . _4, c ?1 1", { mode: 'acid', velocity: 90, gate: 0.5 });
    expect(p.lengthSteps).toBe(8);
    expect(p.events[0]).toMatchObject({ step: 0, accent: true, velocity: 110, pitch: { kind: 'degree', degree: 0, octave: 0 } });
    expect(p.events[0]!.length).toBeGreaterThan(1.5);
    expect(p.events[1]).toMatchObject({ step: 2, slide: true, pitch: { degree: 2, octave: 1 } });
    expect(p.events[2]).toMatchObject({ step: 4, velocity: 66, pitch: { degree: 4, octave: -1 } });
    expect(p.events[3]!.pitch).toEqual({ kind: 'chord' });
    expect(() => line('0 1 2', { mode: 'degree' })).toThrow();
    expect(() => line('0 . . . . . . x', { mode: 'degree' })).toThrow();
  });

  it('reads drum rows: fills and crashes only on their pass, locked lanes', () => {
    const rows = { BD: 'X...X...X...X...', CH: 'og.gog.gog.gog.g', LT: '............f.f.', CC: 'C...............' };
    const p = drumPattern(rows, 32);
    expect(p.events.filter((e) => e.pitch.kind === 'fixed' && e.pitch.note === 36)).toHaveLength(8);
    expect(p.events.find((e) => e.pitch.kind === 'fixed' && e.pitch.note === 43)!.condition).toEqual({ on: 4, every: 4 });
    const voices = drumVoices(rows, ['CH']);
    expect(voices.find((v) => v.name === 'BD')).toMatchObject({ pulses: 4, locked: true });
    expect(voices.find((v) => v.name === 'CH')).toMatchObject({ pulses: 12, locked: false });
    // Fills don't become a basic rhythm when the lane mutates.
    expect(voices.find((v) => v.name === 'LT')!.pulses).toBe(0);
    expect(voices).toHaveLength(11);
  });
});

describe('templates', () => {
  it.each(TEMPLATES.map((t) => t.id))('%s: every part plays, in key and in its range', (id) => {
    const { project, tracks, notes } = play(id, 8);
    const scale = new Scale(project.key.root, project.key.mode);
    tracks.forEach((t, i) => {
      const played = notes[i]!;
      expect(played.length, `${t.name} plays`).toBeGreaterThan(0);
      if (t.generator.type === 'drums') return;
      for (const n of played) {
        expect(scale.contains(n), `${t.name} ${n} in key`).toBe(true);
        expect(n).toBeGreaterThanOrEqual(t.register.low - 12);
        expect(n).toBeLessThanOrEqual(t.register.high + 12);
      }
    });
  });

  it('written parts start from their pattern and keep a theme to return to', () => {
    for (const t of TEMPLATES) {
      const p = createProject(t.id);
      for (const track of p.tracks) {
        if (track.phrase?.answer || track.generator.type === 'drone') continue;
        expect(track.userPattern, `${t.id} ${track.name}`).toBeDefined();
        expect(track.generator.params.lengthSteps).toBe(track.userPattern!.lengthSteps);
        expect(track.frozen).toBe(false);
      }
    }
  });

  it('the kick and backbeat are locked; hats evolve', () => {
    const drums = createProject('techno').tracks.find((t) => t.generator.type === 'drums')!;
    const voices = drums.generator.type === 'drums' ? drums.generator.params.voices : [];
    expect(voices.find((v) => v.name === 'BD')!.locked).toBe(true);
    expect(voices.find((v) => v.name === 'HC')!.locked).toBe(true);
    expect(voices.find((v) => v.name === 'CH')!.locked).toBe(false);
  });
});

describe('best-fit instruments', () => {
  const hw: Rack = {
    devices: [
      newDevice({ name: 'Hydrasynth', portName: 'Hydrasynth', roles: ['lead'], instrumentId: 'asm-hydrasynth' }),
      newDevice({ name: 'TB-03', portName: 'TB-03', channel: 2, roles: ['bass'], instrumentId: 'roland-tb-03' }),
      newDevice({ name: 'Wavestate', portName: 'wavestate', channel: 3, roles: ['pad'], instrumentId: 'korg-wavestate' }),
      newDevice({ name: 'TR-8S', portName: 'TR-8S', channel: 10, roles: ['drums'], clock: true, instrumentId: 'roland-tr-8s' }),
    ],
  };
  const fit = (id: string, rack: Rack) => assignBestFit(createProject(id), rack, BUILT_IN_INSTRUMENTS, templateSounds(id));
  const portOf = (p: ReturnType<typeof fit>, rack: Rack, name: string) =>
    resolveProject(p, rack).tracks.find((t) => t.name === name)!.output.portName;

  it('without devices, every part gets a suitable built-in synth with its sound', () => {
    const p = fit('acid', { devices: [] });
    expect(portOf(p, { devices: [] }, '303')).toBe(LOCAL_PORTS.mono);
    expect(portOf(p, { devices: [] }, 'Drums')).toBe(LOCAL_PORTS.drums);
    expect(portOf(p, { devices: [] }, 'Stab')).toBe(LOCAL_PORTS.juno);
    expect(p.tracks.find((t) => t.name === 'Stab')!.panel?.preset?.name).toBe('Brass');
    expect(p.tracks.find((t) => t.name === '303')!.instrumentId).toBe('drift-synth-mono');
  });

  it('hardware first, one part per synth, built-ins fill the gaps', () => {
    const p = fit('deep-house', hw);
    expect(portOf(p, hw, 'Drums')).toBe('TR-8S');
    expect(portOf(p, hw, 'Bass')).toBe('TB-03');
    expect(portOf(p, hw, 'Stabs')).toBe('wavestate');
    expect(portOf(p, hw, 'Keys')).toBe('Hydrasynth');
    // Wavestate already plays the stabs: the pad goes to a built-in.
    expect(portOf(p, hw, 'Pad')).toBe(LOCAL_PORTS.pad);
    // Later device assignment keeps the built-in choice.
    expect(portOf(assignDevices(p, hw), hw, 'Pad')).toBe(LOCAL_PORTS.pad);
    const used = p.tracks.map((t) => t.deviceId).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });

  it('a call and its answer share one instrument', () => {
    const p = fit('conversation', hw);
    expect(portOf(p, hw, 'Answer')).toBe(portOf(p, hw, 'Call'));
  });

  it('your own synth for a role beats a built-in', () => {
    const rack: Rack = { devices: [newDevice({ name: 'minilogue', portName: 'minilogue xd', roles: ['lead', 'pad'] })] };
    const p = fit('trance', rack);
    expect(portOf(p, rack, 'Anthem')).toBe('minilogue xd');
    expect(portOf(p, rack, 'Drums')).toBe(LOCAL_PORTS.drums);
  });
});
