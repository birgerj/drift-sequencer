import { describe, expect, it } from 'vitest';
import tb03 from '../src/core/instruments/data/roland-tb-03.json';
import hydra from '../src/core/instruments/data/asm-hydrasynth.json';
import { panelPages } from '../src/ui/components/KnobPanel';
import { choiceLabel, choiceValue, widgetParams, type InstrumentDefinition } from '../src/core/instruments/instrument';
import { BUILT_IN_INSTRUMENTS } from '../src/state/instrumentLibrary';

describe('module panels of the built-in synths', () => {
  const drift = BUILT_IN_INSTRUMENTS.filter((d) => d.id.startsWith('drift-synth-'));

  it('every built-in synth has one', () => {
    expect(drift.length).toBeGreaterThanOrEqual(6);
    for (const def of drift) expect(def.panel?.length, def.id).toBeGreaterThan(0);
  });

  it.each(drift.map((d) => [d.id, d] as const))('%s shows every CC knob exactly once', (_, def) => {
    const ids = def.panel!.flatMap((m) => m.widgets.flatMap(widgetParams));
    const known = new Set(def.params.map((p) => p.id));
    for (const id of ids) expect(known.has(id), `${def.id}: unknown param ${id}`).toBe(true);
    expect(new Set(ids).size, `${def.id}: a param appears twice`).toBe(ids.length);
    const cc = def.params.filter((p) => p.msg.type === 'cc' && p.msg.lsb === undefined).map((p) => p.id);
    expect([...ids].sort()).toEqual([...cc].sort());
    for (const m of def.panel!) {
      for (const w of m.widgets) {
        if (w.kind === 'switch') expect(def.params.find((p) => p.id === w.param)!.choices?.length, w.param).toBeGreaterThan(1);
        if (w.kind === 'lfo') expect(known.has(w.rate)).toBe(true);
      }
    }
  });

  it('picking a choice sends a value inside its band', () => {
    for (const def of drift) {
      for (const p of def.params.filter((x) => x.choices)) {
        p.choices!.forEach((c, i) => expect(choiceLabel(p, choiceValue(p, i)), `${def.id} ${p.id}`).toBe(c.label));
      }
    }
  });
});

describe('knob panel pages', () => {
  it('puts the TB-03 filter knobs on the first page', () => {
    const pages = panelPages(tb03 as unknown as InstrumentDefinition);
    expect(pages[0]!.params.slice(0, 2).map((p) => p.name)).toEqual(['Filter cutoff frequency', 'Resonance']);
    expect(pages.every((p) => p.params.length <= 8)).toBe(true);
  });

  it('starts the Hydrasynth with Filter and never shows more than 8 knobs per page', () => {
    const pages = panelPages(hydra as unknown as InstrumentDefinition);
    expect(pages[0]!.name).toMatch(/^Filter/);
    expect(pages.every((p) => p.params.length > 0 && p.params.length <= 8)).toBe(true);
    const ccs = pages.flatMap((p) => p.params.map((x) => (x.msg.type === 'cc' ? x.msg.cc : -1)));
    expect(new Set(ccs).size).toBe(ccs.length);
  });
});
