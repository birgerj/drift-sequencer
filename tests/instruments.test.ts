import { describe, expect, it } from 'vitest';
import { convertMidiGuide, parseCsv } from '../src/core/instruments/midiGuide';
import { MidiGuideClient, parseTree } from '../src/io/midiGuideClient';
import { InstrumentLibrary, MemoryInstrumentStore } from '../src/state/instrumentLibrary';

const HEADER =
  'manufacturer,device,section,parameter_name,parameter_description,cc_msb,cc_lsb,cc_min_value,cc_max_value,cc_default_value,nrpn_msb,nrpn_lsb,nrpn_min_value,nrpn_max_value,nrpn_default_value,orientation,notes,usage';
const CSV = [
  HEADER,
  'Acme,Synth One,Filter,Cutoff,"Filter cutoff, low pass",74,,0,127,64,,,,,,0-based,,',
  'Acme,Synth One,Filter,Resonance,,71,,0,127,,,,,,,0-based,"Says ""hi""",0~127: amount',
  'Acme,Synth One,Osc,Fine,,,,,,,1,20,0,16383,8192,centered,,',
  'Acme,Synth One,Misc,Nothing,,,,,,,,,,,,0-based,,',
].join('\r\n');
const TRIGGERS = [
  'manufacturer,device,section,sound_name,sound_description,midi_channel,note_number_min_value,note_number_max_value,note_number_default_value,comments,velocity_usage',
  'Acme,Synth One,Default note map,Kick,,10,36,36,36,,',
].join('\n');

describe('midi.guide import', () => {
  it('parses quoted CSV fields', () => {
    const rows = parseCsv(CSV);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.parameter_description).toBe('Filter cutoff, low pass');
    expect(rows[1]!.notes).toBe('Says "hi"');
  });

  it('converts CC, NRPN and triggers; skips rows without a message', () => {
    const def = convertMidiGuide(CSV, TRIGGERS);
    expect(def.id).toBe('acme-synth-one');
    expect(def.params.map((p) => p.id)).toEqual(['filter-cutoff', 'filter-resonance', 'osc-fine']);
    expect(def.params[0]).toMatchObject({ msg: { type: 'cc', cc: 74 }, default: 64, bipolar: false });
    expect(def.params[2]).toMatchObject({ msg: { type: 'nrpn', msb: 1, lsb: 20 }, max: 16383, bipolar: true });
    expect(def.triggers).toEqual([{ name: 'Kick', note: 36, channel: 10, map: 'Default note map' }]);
    expect(def.defaultChannel).toBe(10);
  });

  it('rejects files that are not device CSVs', () => {
    expect(() => convertMidiGuide(TRIGGERS)).toThrow(/triggers file/);
    expect(() => convertMidiGuide('a,b\n1,2')).toThrow(/Not a midi.guide CSV/);
  });

  it('lists devices from the GitHub tree and downloads a definition', async () => {
    const tree = JSON.stringify({
      tree: [
        { path: 'Acme', type: 'tree' },
        { path: 'Acme/Synth One.csv', type: 'blob' },
        { path: 'Acme/Synth One.triggers.csv', type: 'blob' },
        { path: 'README.md', type: 'blob' },
      ],
    });
    expect(parseTree(tree)).toEqual([
      { manufacturer: 'Acme', device: 'Synth One', path: 'Acme/Synth One.csv', hasTriggers: true },
    ]);
    const urls: string[] = [];
    const client = new MidiGuideClient(async (url) => {
      urls.push(url);
      const body = url.includes('api.github.com') ? tree : url.endsWith('.triggers.csv') ? TRIGGERS : CSV;
      return { ok: true, status: 200, text: async () => body };
    }, undefined);
    const [device] = await client.listDevices();
    const def = await client.fetchDefinition(device!);
    expect(def.triggers).toHaveLength(1);
    expect(urls[1]).toBe('https://raw.githubusercontent.com/pencilresearch/midi/main/Acme/Synth%20One.csv');
  });
});

describe('InstrumentLibrary', () => {
  it('includes built-ins and imported definitions', async () => {
    const lib = new InstrumentLibrary(new MemoryInstrumentStore());
    expect((await lib.list()).some((i) => i.definition.id === 'roland-tr-8s' && i.builtIn)).toBe(true);
    await lib.import(convertMidiGuide(CSV));
    expect(await lib.get('acme-synth-one')).toBeDefined();
    await lib.remove('acme-synth-one');
    expect(await lib.get('acme-synth-one')).toBeUndefined();
  });
});
