import { describe, expect, it } from 'vitest';
import piano from '../src/core/instruments/data/drift-synth-piano.json';
import { presetCcValues, type InstrumentDefinition } from '../src/core/instruments/instrument';
import { LOCAL_CC } from '../src/io/local/common';
import { PIANO_CC, PIANO_DEFAULTS, releaseSeconds, toneHz } from '../src/io/local/piano';
import { LOCAL_PORTS } from '../src/io/local/ports';
import {
  PIANO_PACKS,
  pianoLayerFor,
  pianoPackFromCc,
  pianoRate,
  pianoZoneFor,
  type PianoLayer,
  type PianoManifest,
} from '../src/io/local/samplePianos';
import { BUILT_IN_INSTRUMENTS } from '../src/state/instrumentLibrary';
import { suggestInstrument } from '../src/state/rack';

const def = piano as unknown as InstrumentDefinition;
const ccOf = (p: InstrumentDefinition['params'][number]) => (p.msg.type === 'cc' ? p.msg.cc : -1);
const CHANNEL_CCS: number[] = [LOCAL_CC.volume, LOCAL_CC.reverb, LOCAL_CC.delay];
const manifests = import.meta.glob<PianoManifest>('../public/pianos/*/piano.json', { eager: true, import: 'default' });
const audioFiles = new Set(Object.keys(import.meta.glob('../public/pianos/*/*.flac')));
const attribution = import.meta.glob<string>('../public/pianos/ATTRIBUTION.md', { eager: true, query: '?raw', import: 'default' });
const manifest = (id: string) => manifests[`../public/pianos/${id}/piano.json`]!;

describe('Drift Synth Piano: definition', () => {
  it('is a built-in port and its definition is suggested for it', () => {
    expect(LOCAL_PORTS.piano).toBe('Drift Synth Piano');
    expect(suggestInstrument(LOCAL_PORTS.piano, BUILT_IN_INSTRUMENTS)?.id).toBe('drift-synth-piano');
  });

  it('has a knob for every piano CC with the same default, and nothing else', () => {
    for (const [key, cc] of Object.entries(PIANO_CC)) {
      const p = def.params.find((x) => ccOf(x) === cc);
      expect(p, key).toBeDefined();
      expect(p!.default, key).toBe(PIANO_DEFAULTS[key as keyof typeof PIANO_DEFAULTS]);
    }
    const known = new Set<number>([...Object.values(PIANO_CC), ...CHANNEL_CCS]);
    for (const p of def.params) expect(known.has(ccOf(p)), p.name).toBe(true);
  });

  it('its pack switch lists the packs in knob order', () => {
    const pack = def.params.find((p) => p.id === 'pack')!;
    expect(pack.choices!.map((c) => c.label)).toEqual(PIANO_PACKS.map((p) => p.name));
    for (const [i, c] of pack.choices!.entries()) expect(pianoPackFromCc(c.upTo)).toBe(PIANO_PACKS[i]!.id);
  });

  it('every preset names real knobs, and together they use every pack', () => {
    const ids = new Set(def.params.map((p) => p.id));
    const packs = new Set<string>();
    for (const preset of def.presets!) {
      for (const id of Object.keys(preset.values)) expect(ids.has(id), `${preset.name}: ${id}`).toBe(true);
      packs.add(pianoPackFromCc(presetCcValues(def, preset)[PIANO_CC.pack]!));
    }
    expect([...packs].sort()).toEqual(PIANO_PACKS.map((p) => p.id).sort());
  });

  it('a preset named after a pack plays that pack', () => {
    for (const pack of PIANO_PACKS) {
      const preset = def.presets!.find((p) => p.name === pack.name);
      expect(preset, pack.name).toBeDefined();
      expect(pianoPackFromCc(presetCcValues(def, preset!)[PIANO_CC.pack]!)).toBe(pack.id);
    }
  });
});

describe('Drift Synth Piano: knobs', () => {
  it('maps the pack knob to four equal bands', () => {
    expect([0, 31, 32, 63, 64, 95, 96, 127].map(pianoPackFromCc)).toEqual(['grand', 'grand', 'steinway', 'steinway', 'studio', 'studio', 'wurli', 'wurli']);
  });

  it('tone opens fully at the top and release grows with the knob', () => {
    expect(toneHz(127)).toBe(20000);
    expect(toneHz(0)).toBeCloseTo(300);
    expect(toneHz(64)).toBeLessThan(toneHz(100));
    expect(releaseSeconds(0)).toBeCloseTo(0.05);
    expect(releaseSeconds(127)).toBeCloseTo(4);
  });
});

describe('Drift Synth Piano: zones and layers', () => {
  const layers: PianoLayer[] = [
    { hivel: 84, zones: [{ lo: 21, hi: 61, key: 60, file: 'a' }, { lo: 62, hi: 108, key: 63, tune: -10, file: 'b' }] },
    { hivel: 127, zones: [{ lo: 40, hi: 108, key: 64, file: 'c' }] },
  ];

  it('picks the layer by velocity, soft to hard', () => {
    expect(pianoLayerFor(layers, 0.5).hivel).toBe(84);
    expect(pianoLayerFor(layers, 84 / 127).hivel).toBe(84);
    expect(pianoLayerFor(layers, 85 / 127).hivel).toBe(127);
    expect(pianoLayerFor(layers, 1).hivel).toBe(127);
  });

  it('picks the zone that holds the note, else the nearest sample', () => {
    expect(pianoZoneFor(layers[0]!, 62).file).toBe('b');
    expect(pianoZoneFor(layers[1]!, 30).file).toBe('c');
  });

  it('pitches the sample to the note, with the zone tuning', () => {
    expect(pianoRate({ lo: 0, hi: 127, key: 60, file: '' }, 72)).toBeCloseTo(2);
    expect(pianoRate({ lo: 0, hi: 127, key: 60, file: '' }, 60)).toBe(1);
    expect(pianoRate({ lo: 0, hi: 127, key: 60, tune: 100, file: '' }, 60)).toBeCloseTo(Math.pow(2, -1 / 12));
  });
});

describe('piano packs (public/pianos)', () => {
  for (const pack of PIANO_PACKS) {
    it(`${pack.name}: covers the whole keyboard in every layer, and its files exist`, () => {
      const m = manifest(pack.id);
      expect(m.id).toBe(pack.id);
      expect(m.name).toBe(pack.name);
      expect(m.gain).toBeGreaterThan(0);
      expect(m.layers.length).toBeGreaterThanOrEqual(2);
      expect(m.layers.at(-1)!.hivel).toBe(127);
      const files = new Set<string>();
      m.layers.forEach((layer, i) => {
        if (i > 0) expect(layer.hivel).toBeGreaterThan(m.layers[i - 1]!.hivel);
        let next = 21;
        for (const z of layer.zones) {
          expect(z.lo, `${pack.id} layer ${i}`).toBe(next);
          expect(z.hi).toBeGreaterThanOrEqual(z.lo);
          // A sample is never stretched far from its own pitch inside its zone (Wurlitzer's lowest key aside).
          expect(Math.max(z.key - z.lo, z.hi - z.key), `${pack.id} zone ${z.key}`).toBeLessThanOrEqual(pack.id === 'wurli' ? 16 : 8);
          next = z.hi + 1;
          files.add(z.file);
        }
        expect(next, `${pack.id} layer ${i} ends`).toBe(109);
      });
      for (const f of files) expect(audioFiles.has(`../public/pianos/${pack.id}/${f}`), f).toBe(true);
    });
  }

  it('lists every pack with its license', () => {
    const credits = attribution['../public/pianos/ATTRIBUTION.md']!;
    for (const pack of PIANO_PACKS) expect(credits).toContain(`## ${pack.name} (\`${pack.id}/\`)`);
  });
});
