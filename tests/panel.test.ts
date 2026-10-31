import { describe, expect, it } from 'vitest';
import tb03 from '../src/core/instruments/data/roland-tb-03.json';
import hydra from '../src/core/instruments/data/asm-hydrasynth.json';
import { panelPages } from '../src/ui/components/KnobPanel';
import type { InstrumentDefinition } from '../src/core/instruments/instrument';

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
