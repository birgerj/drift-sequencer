import { describe, expect, it } from 'vitest';
import driftDrums from '../src/core/instruments/data/drift-synth-drums.json';
import { choiceLabel, type InstrumentDefinition } from '../src/core/instruments/instrument';
import { layerFor, piecesForNote, SAMPLE_KITS, sampleKitFromCc, SAMPLES_CC } from '../src/io/local/sampleKits';

const def = driftDrums as InstrumentDefinition;
type Manifest = { name: string; pieces: Record<string, { layers: string[] }> };
const manifests = import.meta.glob<Manifest>('../public/kits/*/kit.json', { eager: true, import: 'default' });
const audioFiles = new Set(Object.keys(import.meta.glob('../public/kits/*/*.flac')));

describe('sampled drum kits', () => {
  it('keeps the synth kit below the first band and covers every kit', () => {
    expect(sampleKitFromCc(0)).toBeUndefined();
    expect(sampleKitFromCc(20)).toBeUndefined();
    const seen = new Set<string>();
    for (let v = 21; v <= 127; v++) seen.add(sampleKitFromCc(v)!);
    expect([...seen]).toEqual(SAMPLE_KITS.map((k) => k.id));
  });

  it('labels the Samples knob exactly like the playback bands', () => {
    const param = def.params.find((p) => p.msg.type === 'cc' && p.msg.cc === SAMPLES_CC)!;
    for (let v = 0; v <= 127; v++) {
      const id = sampleKitFromCc(v);
      expect(choiceLabel(param, v)).toBe(id ? SAMPLE_KITS.find((k) => k.id === id)!.name : 'Off');
    }
  });

  it('picks velocity layers soft to hard', () => {
    expect(layerFor(0, 5)).toBe(0);
    expect(layerFor(0.5, 5)).toBe(2);
    expect(layerFor(1, 5)).toBe(4);
    expect(layerFor(1, 1)).toBe(0);
  });

  it('has a sample for every drum lane of the definition, in every kit', () => {
    for (const kit of SAMPLE_KITS) {
      const manifest = manifests[`../public/kits/${kit.id}/kit.json`]!;
      expect(manifest, kit.id).toBeDefined();
      expect(manifest.name).toBe(kit.name);
      for (const piece of Object.values(manifest.pieces)) for (const f of piece.layers) expect(audioFiles.has(`../public/kits/${kit.id}/${f}`), f).toBe(true);
      // Clap may fall back to the synth (the brushes kit has none); everything else must be sampled.
      for (const t of def.triggers.filter((x) => x.note !== 39)) {
        expect(piecesForNote(t.note).some((p) => manifest.pieces[p]), `${kit.id} ${t.name}`).toBe(true);
      }
    }
  });
});
