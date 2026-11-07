import { describe, expect, it } from 'vitest';
import { Sequencer } from '../src/core/engine/sequencer';
import { RecordingOutput, StaticPortResolver } from '../src/io/midi/output';
import { BUILT_IN_INSTRUMENTS } from '../src/state/instrumentLibrary';
import {
  assignDevices,
  devicesFromPorts,
  guessPorts,
  loadBuiltInAliases,
  loadRack,
  newDevice,
  releaseBuiltIns,
  resolveProject,
  saveBuiltInAliases,
  saveRack,
  splitBuiltIns,
  suggestInstrument,
  type Rack,
} from '../src/state/rack';
import { createProject, TEMPLATES } from '../src/state/templates';
import { builtInShortName, outputLabel } from '../src/io/local/ports';

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
    const lead = p.tracks.find((t) => t.name === 'Hook')!;
    const leadOf = (q: typeof p) => q.tracks.find((t) => t.id === lead.id)!;
    const moved = { ...p, tracks: p.tracks.map((t) => (t.id === lead.id ? { ...t, deviceId: rack.devices[1]!.id } : t)) };
    expect(leadOf(assignDevices(moved, rack)).deviceId).toBe(rack.devices[1]!.id);
    expect(leadOf(assignDevices(moved, rack, true)).deviceId).toBe(rack.devices[0]!.id);
    const broken = { ...p, tracks: p.tracks.map((t) => ({ ...t, deviceId: 'gone' })) };
    expect(leadOf(assignDevices(broken, rack)).deviceId).toBe(rack.devices[0]!.id);
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

describe('built-in synths are not devices', () => {
  const hw = newDevice({ name: 'Hydrasynth', portName: 'Hydrasynth', roles: ['lead'] });
  const juno = newDevice({ name: 'Synth Juno', portName: 'Drift Synth Juno', channel: 3, roles: ['pad'] });

  it('takes built-ins out of the rack and remembers where they pointed', () => {
    const { rack, aliases } = splitBuiltIns({ devices: [hw, juno] });
    expect(rack.devices.map((d) => d.id)).toEqual([hw.id]);
    expect(aliases).toEqual({ [juno.id]: { portName: 'Drift Synth Juno', channel: 3 } });
    const same = { devices: [hw] };
    expect(splitBuiltIns(same).rack).toBe(same);
  });

  it('tracks that played a built-in through a device now play it directly, keeping their knobs', () => {
    const project = createProject('deep-house');
    const [a, b] = project.tracks;
    const before = {
      ...project,
      tracks: [{ ...a!, deviceId: juno.id, panel: { values: { 74: 40 } } }, { ...b!, deviceId: hw.id }, ...project.tracks.slice(2)],
    };
    const { aliases } = splitBuiltIns({ devices: [hw, juno] });
    const after = releaseBuiltIns(before, aliases);
    expect(after.tracks[0]).toMatchObject({ output: { portName: 'Drift Synth Juno', channel: 3 }, instrumentId: 'drift-synth-juno', panel: { values: { 74: 40 } } });
    expect(after.tracks[0]!.deviceId).toBeUndefined();
    expect(after.tracks[1]!.deviceId).toBe(hw.id);
    // Later device assignment leaves the built-in alone.
    expect(assignDevices(after, { devices: [hw] }).tracks[0]!.deviceId).toBeUndefined();
    expect(releaseBuiltIns(after, aliases)).toBe(after);
  });

  it('stores the aliases', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    saveBuiltInAliases({ x: { portName: 'Drift Synth Hum', channel: 1 } }, storage);
    expect(loadBuiltInAliases(storage)).toEqual({ x: { portName: 'Drift Synth Hum', channel: 1 } });
    expect(loadBuiltInAliases({ getItem: () => 'nonsense' })).toEqual({});
  });
});

describe('output labels', () => {
  it('built-ins show no MIDI channel; devices and ports do', () => {
    expect(outputLabel('Drift Synth Bass', 1)).toBe('Synth Bass');
    expect(outputLabel('Hydrasynth', 2, 'Hydra')).toBe('Hydra · ch 2');
    expect(outputLabel('TR-8S', 10)).toBe('TR-8S · ch 10');
    expect(builtInShortName('Drift Synth Juno')).toBe('Juno');
  });
});

describe('adding connected devices', () => {
  it('makes a device per new hardware port, with guessed roles, drum channel and clock', () => {
    const made = devicesFromPorts(['Hydrasynth', 'TB-03', 'TR-8S', 'wavestate', 'Drift Synth Juno'], { devices: [] }, BUILT_IN_INSTRUMENTS);
    const by = (port: string) => made.find((d) => d.portName === port)!;
    expect(made.map((d) => d.portName)).toEqual(['Hydrasynth', 'TB-03', 'TR-8S', 'wavestate']);
    expect(by('TR-8S')).toMatchObject({ roles: ['drums'], channel: 10, clock: true, instrumentId: 'roland-tr-8s' });
    expect(by('TB-03').roles).toEqual(['bass']);
    expect(by('wavestate').roles).toEqual(['pad']);
    expect(by('Hydrasynth')).toMatchObject({ roles: ['lead'], clock: false, instrumentId: 'asm-hydrasynth' });
  });

  it('skips ports already set up and roles already taken', () => {
    const existing: Rack = { devices: [newDevice({ name: 'TR-8S', portName: 'TR-8S', channel: 10, roles: ['drums'], clock: true })] };
    const made = devicesFromPorts(['TR-8S', 'TR-6S', 'minilogue xd'], existing, BUILT_IN_INSTRUMENTS);
    expect(made.map((d) => d.portName)).toEqual(['TR-6S', 'minilogue xd']);
    expect(made.find((d) => d.portName === 'TR-6S')).toMatchObject({ roles: [], clock: false });
    expect(made.find((d) => d.portName === 'minilogue xd')!.roles).toContain('lead');
  });
});
