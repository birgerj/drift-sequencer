import { describe, expect, it } from 'vitest';
import tb03 from '../src/core/instruments/data/roland-tb-03.json';
import hydra from '../src/core/instruments/data/asm-hydrasynth.json';
import tr8s from '../src/core/instruments/data/roland-tr-8s.json';
import wavestate from '../src/core/instruments/data/korg-wavestate.json';
import { parseUsageChoices, withAutoPanel } from '../src/core/instruments/autoPanel';
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

describe('automatic panel for imported definitions', () => {
  const ccIds = (d: InstrumentDefinition) => d.params.filter((p) => p.msg.type === 'cc' && p.msg.lsb === undefined && p.msg.cc < 120).map((p) => p.id);
  const shown = (d: InstrumentDefinition) => d.panel!.flatMap((m) => m.widgets.flatMap(widgetParams));
  const kinds = (d: InstrumentDefinition) => d.panel!.flatMap((m) => m.widgets.map((w) => w.kind));

  it.each([
    ['TB-03', tb03],
    ['Hydrasynth', hydra],
    ['TR-8S', tr8s],
    ['Wavestate', wavestate],
  ] as const)('%s shows every CC once', (_, raw) => {
    const def = withAutoPanel(raw as unknown as InstrumentDefinition);
    const ids = shown(def);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...ccIds(def)].sort());
  });

  it('gives the TB-03 a filter pad first and a slide switch', () => {
    const def = withAutoPanel(tb03 as unknown as InstrumentDefinition);
    const first = def.panel![0]!.widgets;
    expect(first.find((w) => w.kind === 'xy')).toMatchObject({ x: 'all-ccs-filter-cutoff-frequency', y: 'all-ccs-resonance' });
    expect(def.params.find((p) => p.name === 'Slide status')!.choices!.map((c) => c.label)).toEqual(['Off', 'On']);
  });

  it('splits the Hydrasynth into envelopes, filters and a mixer, behind tabs', () => {
    const def = withAutoPanel(hydra as unknown as InstrumentDefinition);
    expect(def.panel![0]!.title).toMatch(/^Filter/);
    expect(kinds(def).filter((k) => k === 'adsr')).toHaveLength(5);
    expect(def.panel!.map((m) => m.title)).toEqual(expect.arrayContaining(['Filter F1', 'ENV1', 'Oscillator', 'LFO', 'Mutator', 'Delay', 'Reverb']));
    expect(kinds(def).filter((k) => k === 'xy')).toHaveLength(2);
    expect(def.panel!.some((m) => m.widgets.some((w) => w.kind === 'strips' && w.strips.length === 3 && w.strips.every((s) => s.level)))).toBe(true);
    const tabs = [...new Set(def.panel!.map((m) => m.group))];
    expect(tabs.length).toBeGreaterThan(1);
    expect(tabs.length).toBeLessThanOrEqual(10);
    expect(tabs.some((t) => t!.includes(' · '))).toBe(true);
    expect(def.params.find((p) => p.name === 'ENV1 Attack')!.short).toBe('Attack');
  });

  it('puts the TR-8S voices in channel strips with a level fader each', () => {
    const def = withAutoPanel(tr8s as unknown as InstrumentDefinition);
    const w = def.panel![0]!.widgets[0]!;
    if (w.kind !== 'strips') throw new Error(`expected strips, got ${w.kind}`);
    expect(w.strips.map((s) => s.title)).toEqual(['BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'HC', 'CH', 'OH', 'CC', 'RC']);
    expect(w.strips.every((s) => s.level && s.params.length === 3)).toBe(true);
  });

  it('leaves the original definition untouched and keeps a hand-made panel', () => {
    const raw = hydra as unknown as InstrumentDefinition;
    withAutoPanel(raw);
    expect(raw.panel).toBeUndefined();
    expect(raw.params.some((p) => p.short)).toBe(false);
    const juno = BUILT_IN_INSTRUMENTS.find((d) => d.id === 'drift-synth-juno')!;
    expect(withAutoPanel(juno)).toBe(juno);
  });
});

describe('usage text → choices', () => {
  it('reads value bands', () => {
    expect(parseUsageChoices('0~42: saw, 43~85: pulse, 86~127: triangle')).toEqual([
      { upTo: 42, label: 'Saw' },
      { upTo: 85, label: 'Pulse' },
      { upTo: 127, label: 'Triangle' },
    ]);
    expect(parseUsageChoices('0-63: Off; 64-127: On')).toEqual([
      { upTo: 63, label: 'Off' },
      { upTo: 127, label: 'On' },
    ]);
    expect(parseUsageChoices('0: Off, 1: On', 0, 1)).toEqual([
      { upTo: 0, label: 'Off' },
      { upTo: 1, label: 'On' },
    ]);
  });

  it('ignores prose', () => {
    expect(parseUsageChoices('0~3: off')).toBeUndefined();
    expect(parseUsageChoices('64: in tune, ±50 cents')).toBeUndefined();
    expect(parseUsageChoices('Extra level on accented notes')).toBeUndefined();
    expect(parseUsageChoices('0: square, up: narrower')).toBeUndefined();
  });
});
