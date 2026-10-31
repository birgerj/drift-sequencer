import { describe, expect, it } from 'vitest';
import { Sequencer } from '../src/core/engine/sequencer';
import { RecordingOutput, StaticPortResolver } from '../src/io/midi/output';
import { BUILT_IN_INSTRUMENTS } from '../src/state/instrumentLibrary';
import {
  assignDevices,
  guessPorts,
  loadRack,
  newDevice,
  resolveProject,
  saveRack,
  suggestInstrument,
  type Rack,
} from '../src/state/rack';
import { createProject, TEMPLATES } from '../src/state/templates';

const rack: Rack = {
  devices: [
    newDevice({ name: 'Minilogue', portName: 'minilogue xd SOUND', channel: 1, roles: ['lead', 'pad'] }),
    newDevice({ name: 'TD-3', portName: 'TD-3', channel: 2, roles: ['bass'] }),
    newDevice({ name: 'TR-8S', portName: 'TR-8S', channel: 10, roles: ['drums'], clock: true, instrumentId: 'roland-tr-8s' }),
  ],
};

describe('rack', () => {
  it('every template gets the same devices by role', () => {
    for (const t of TEMPLATES) {
      const p = resolveProject(assignDevices(createProject(t.id), rack), rack);
      for (const track of p.tracks) {
        expect(rack.devices.map((d) => d.portName)).toContain(track.output.portName);
        if (track.generator.type === 'drums') expect(track.output).toEqual({ portName: 'TR-8S', channel: 10 });
        if (track.generator.type === 'bass') expect(track.output.portName).toBe('TD-3');
      }
      expect(p.clock.sendTo).toEqual(['TR-8S']);
    }
  });

  it('pads fall back to the lead device', () => {
    const noPad: Rack = { devices: rack.devices.map((d) => ({ ...d, roles: d.roles.filter((r) => r !== 'pad') })) };
    const p = resolveProject(assignDevices(createProject('deep-house'), noPad), noPad);
    expect(p.tracks.find((t) => t.name === 'Pad')!.output.portName).toBe('minilogue xd SOUND');
  });

  it('keeps chosen devices unless forced, and repairs unknown ones', () => {
    const p = assignDevices(createProject('techno'), rack);
    const lead = p.tracks[0]!;
    const moved = { ...p, tracks: p.tracks.map((t) => (t.id === lead.id ? { ...t, deviceId: rack.devices[1]!.id } : t)) };
    expect(assignDevices(moved, rack).tracks[0]!.deviceId).toBe(rack.devices[1]!.id);
    expect(assignDevices(moved, rack, true).tracks[0]!.deviceId).toBe(rack.devices[0]!.id);
    const broken = { ...p, tracks: p.tracks.map((t) => ({ ...t, deviceId: 'gone' })) };
    expect(assignDevices(broken, rack).tracks[0]!.deviceId).toBe(rack.devices[0]!.id);
  });

  it('without devices, projects use their own ports', () => {
    const p = createProject('techno');
    expect(resolveProject(assignDevices(p, { devices: [] }), { devices: [] })).toBe(p);
  });

  it('the engine plays on the rack ports', () => {
    const outs = ['minilogue xd SOUND', 'TD-3', 'TR-8S'].map((n) => new RecordingOutput(n));
    const p = resolveProject(assignDevices(createProject('techno'), rack), rack);
    const seq = new Sequencer(p, new StaticPortResolver(outs));
    seq.start();
    seq.stop();
    expect(outs[2]!.sent.map((m) => m.data[0])).toContain(0xfa); // clock start to TR-8S
  });

  it('guesses ports and suggests instruments by name', () => {
    expect(guessPorts(['minilogue xd SOUND', 'TR-8S', 'TD-3'])).toMatchObject({ drums: 'TR-8S', lead: 'minilogue xd SOUND', bass: 'TD-3' });
    expect(suggestInstrument('TR-8S', BUILT_IN_INSTRUMENTS)?.id).toBe('roland-tr-8s');
    expect(suggestInstrument('USB MIDI Interface', BUILT_IN_INSTRUMENTS)).toBeUndefined();
  });

  it('saves and loads', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveRack(rack, storage);
    expect(loadRack(storage)).toEqual(rack);
  });
});

describe('port guessing for a real setup', () => {
  it('Hydrasynth lead, TB-03 bass, Wavestate pad, TR-8S drums', () => {
    const ports = ['TR-8S CTRL', 'wavestate SOUND', 'TB-03', 'HYDRASYNTH EXPLORER', 'TR-8S'];
    expect(guessPorts(ports)).toEqual({ drums: 'TR-8S', lead: 'HYDRASYNTH EXPLORER', bass: 'TB-03', pad: 'wavestate SOUND' });
    expect(guessPorts(['HYDRASYNTH EXPLORER', 'TB-03', 'wavestate SOUND', 'TR-8S'])).toEqual({
      drums: 'TR-8S',
      lead: 'HYDRASYNTH EXPLORER',
      bass: 'TB-03',
      pad: 'wavestate SOUND',
    });
    for (const [port, id] of [
      ['HYDRASYNTH EXPLORER', 'asm-hydrasynth'],
      ['TB-03', 'roland-tb-03'],
      ['wavestate SOUND', 'korg-wavestate'],
      ['TR-8S', 'roland-tr-8s'],
    ]) expect(suggestInstrument(port!, BUILT_IN_INSTRUMENTS)?.id).toBe(id);
  });
});
