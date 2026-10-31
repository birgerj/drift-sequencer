import { describe, expect, it } from 'vitest';
import { DrumGenerator, TR8S_NOTES } from '../src/core/generators/drumGenerator';
import { DRUM_PRESETS, presetPattern, presetVoices, TR8S_VOICE_ORDER } from '../src/core/generators/drumPresets';

describe('drum presets', () => {
  it('every row is 16 valid steps and ids are unique', () => {
    expect(new Set(DRUM_PRESETS.map((p) => p.id)).size).toBe(DRUM_PRESETS.length);
    for (const p of DRUM_PRESETS) {
      for (const [key, row] of Object.entries(p.rows)) {
        expect(row, `${p.id} ${key}`).toMatch(/^[Xxo23.]{16}$/);
      }
    }
  });

  it('builds a pattern on the TR-8S notes and repeats it over 32 steps', () => {
    const house = DRUM_PRESETS.find((p) => p.id === 'house')!;
    const pattern = presetPattern(house, 32);
    const kicks = pattern.events.filter((e) => e.pitch.kind === 'fixed' && e.pitch.note === TR8S_NOTES.BD);
    expect(kicks.map((e) => e.step)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(kicks[0]!.velocity).toBeGreaterThan(110);
  });

  it('turns ratchet marks into ratchets', () => {
    const trap = DRUM_PRESETS.find((p) => p.id === 'trap')!;
    const ratchets = presetPattern(trap).events.filter((e) => e.ratchet);
    expect(ratchets.map((e) => [e.step, e.ratchet])).toEqual([[11, 3], [15, 2]]);
  });

  it('gives generator voices for all 11 instruments that follow the groove', () => {
    const voices = presetVoices(DRUM_PRESETS.find((p) => p.id === 'house')!);
    expect(voices.map((v) => v.name)).toEqual(TR8S_VOICE_ORDER);
    expect(voices.find((v) => v.name === 'BD')).toMatchObject({ pulses: 4, rotate: 0 });
    expect(voices.find((v) => v.name === 'LT')!.pulses).toBe(0);
  });

  it('the default drum track has a lane for each TR-8S instrument', () => {
    expect(new DrumGenerator().defaults().voices.map((v) => v.name)).toEqual(TR8S_VOICE_ORDER);
  });
});

describe('TR-8S lane order', () => {
  it('sorts old voices into panel order and renames CP to HC', async () => {
    const { orderDrumVoices } = await import('../src/core/generators/drumPresets');
    const old = [
      { name: 'BD', note: 36 }, { name: 'SD', note: 38 }, { name: 'CH', note: 42 }, { name: 'OH', note: 46 }, { name: 'CP', note: 39 }, { name: 'X', note: 60 },
    ].map((v) => ({ ...v, pulses: 1, rotate: 0, probability: 1, velocity: 100 }));
    expect(orderDrumVoices(old).map((v) => v.name)).toEqual(['BD', 'SD', 'HC', 'CH', 'OH', 'X']);
  });
});

describe('drum voice mute', () => {
  it('silences a muted voice without changing the pattern', async () => {
    const { TrackRuntime } = await import('../src/core/engine/trackRuntime');
    const { createProject } = await import('../src/state/templates');
    const { Sequencer } = await import('../src/core/engine/sequencer');
    const { StaticPortResolver } = await import('../src/io/midi/output');
    const project = createProject('techno');
    const drums = project.tracks.find((t) => t.generator.type === 'drums')!;
    const seq = new Sequencer(project, new StaticPortResolver([]));
    const before = seq.track(drums.id)!.pattern;
    const g = drums.generator as Extract<typeof drums.generator, { type: 'drums' }>;
    const muted = { ...drums, generator: { ...g, params: { ...g.params, voices: g.params.voices.map((v) => (v.name === 'BD' ? { ...v, muted: true } : v)) } } };
    seq.update({ ...project, tracks: project.tracks.map((t) => (t.id === drums.id ? muted : t)) });
    const rt = seq.track(drums.id)!;
    expect(rt.pattern).toBe(before);
    const moment = seq.harmonyAt(0);
    const notes = Array.from({ length: 16 }, (_, i) => rt.notesAt(i, moment as never)).flat().flatMap((n) => n.notes);
    expect(notes).not.toContain(36);
    expect(TrackRuntime).toBeDefined();
  });
});
