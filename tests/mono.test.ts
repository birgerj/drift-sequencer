import { describe, expect, it } from 'vitest';
import juno from '../src/core/instruments/data/drift-synth-juno.json';
import mono from '../src/core/instruments/data/drift-synth-mono.json';
import { presetCcValues, type InstrumentDefinition } from '../src/core/instruments/instrument';
import { LOCAL_CC } from '../src/io/local/common';
import { LOCAL_PORTS } from '../src/io/local/localSynths';
import { MONO_CC, MONO_DEFAULTS, MONO_PROCESSOR, monoDefaultValues, monoParam } from '../src/io/local/mono/monoParams';
import source from '../src/io/local/mono/monoProcessor.js?raw';
import { WORKLET_MSG } from '../src/io/local/workletSynth';
import { BUILT_IN_INSTRUMENTS } from '../src/state/instrumentLibrary';
import { suggestInstrument } from '../src/state/rack';
import { panelPages } from '../src/ui/components/KnobPanel';

const SR = 48000;
const def = mono as unknown as InstrumentDefinition;
const ccOf = (p: InstrumentDefinition['params'][number]) => (p.msg.type === 'cc' ? p.msg.cc : -1);
const CHANNEL_CCS: number[] = [LOCAL_CC.volume, LOCAL_CC.reverb, LOCAL_CC.delay];

interface Worklet {
  MonoEngine: new (sr: number) => any;
  MonoProcessor: new () => any;
  NoteStack: new () => any;
  registered: string | undefined;
}

/** Evaluates the shipped worklet source the way an AudioWorkletGlobalScope would. */
function loadWorklet(): Worklet {
  let registered: string | undefined;
  const register = (name: string) => (registered = name);
  const exports = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    `${source}\nreturn { MonoEngine, MonoProcessor, NoteStack };`,
  )(class {}, register, SR) as Omit<Worklet, 'registered'>;
  return { ...exports, registered };
}

/** An engine set up the way the app does: defaults, then a preset's CC values. */
function engine(w: Worklet, ccValues: Record<string, number> = {}) {
  const e = new w.MonoEngine(SR);
  for (const [k, v] of monoDefaultValues()) e.set(k, v);
  for (const [cc, v] of Object.entries(ccValues)) {
    const p = monoParam(Number(cc), v);
    if (p) e.set(p[0], p[1]);
  }
  return e;
}

function render(e: any, frames: number) {
  const l = new Float32Array(frames);
  e.render(l, l, 0, frames);
  return l;
}

const peak = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
/** Zero crossings per second: a rough pitch / brightness measure. */
const crossings = (a: Float32Array) => {
  let n = 0;
  for (let i = 1; i < a.length; i++) if ((a[i - 1]! < 0) !== (a[i]! < 0)) n++;
  return (n * SR) / a.length;
};

describe('Drift Synth Mono: definition and CC map', () => {
  it('is a built-in port and its definition is suggested for it, not for the other Drift ports', () => {
    expect(LOCAL_PORTS.mono).toBe('Drift Synth Mono');
    expect(suggestInstrument(LOCAL_PORTS.mono, BUILT_IN_INSTRUMENTS)?.id).toBe('drift-synth-mono');
    expect(suggestInstrument(LOCAL_PORTS.bass, BUILT_IN_INSTRUMENTS)?.id).toBe('drift-synth-bass');
    expect(suggestInstrument(LOCAL_PORTS.juno, BUILT_IN_INSTRUMENTS)?.id).toBe('drift-synth-juno');
  });

  it('every knob in the definition is handled, and every Mono CC has a knob with the same default', () => {
    for (const p of def.params) {
      const cc = ccOf(p);
      expect(CHANNEL_CCS.includes(cc) || monoParam(cc, 64) !== undefined, `${p.name} (CC ${cc})`).toBe(true);
    }
    for (const [key, cc] of Object.entries(MONO_CC)) {
      const p = def.params.find((x) => ccOf(x) === cc);
      expect(p, key).toBeDefined();
      expect(p!.default, key).toBe(MONO_DEFAULTS[key as keyof typeof MONO_DEFAULTS]);
    }
    expect(new Set(Object.values(MONO_CC)).size).toBe(Object.keys(MONO_CC).length);
  });

  it('shares the cutoff, resonance and envelope CCs with the other Drift Synth sounds', () => {
    expect(MONO_CC.cutoff).toBe(LOCAL_CC.cutoff);
    expect(MONO_CC.resonance).toBe(LOCAL_CC.resonance);
    expect(MONO_CC.envMod).toBe(LOCAL_CC.envMod);
    expect(MONO_CC.attack).toBe(LOCAL_CC.attack);
    expect(MONO_CC.release).toBe(LOCAL_CC.release);
  });

  it('maps switches to their positions and knobs to real units', () => {
    expect([0, 42, 43, 85, 86, 127].map((v) => monoParam(MONO_CC.osc2Octave, v)![1])).toEqual([-1, -1, 0, 0, 1, 1]);
    expect(monoParam(MONO_CC.osc2Detune, 64)![1]).toBe(0);
    expect(monoParam(MONO_CC.glide, 0)![1]).toBe(0);
    expect(monoParam(MONO_CC.pw, 0)![1]).toBe(0.5);
    expect(monoParam(LOCAL_CC.waveform, 127)).toEqual(['osc1Wave', 2]);
    expect(monoParam(93, 64)).toBeUndefined();
  });

  it('fits the panel in pages of at most 8 knobs, filter first', () => {
    const pages = panelPages(def);
    expect(pages[0]!.name).toBe('Filter');
    expect(pages.every((p) => p.params.length > 0 && p.params.length <= 8)).toBe(true);
    expect(pages.flatMap((p) => p.params)).toHaveLength(def.params.length);
  });
});

describe('presets', () => {
  for (const d of [def, juno as unknown as InstrumentDefinition]) {
    it(`${d.device}: every preset names real knobs with values in range, and the first one is the default sound`, () => {
      expect(d.presets!.length).toBeGreaterThanOrEqual(5);
      const ids = new Set(d.params.map((p) => p.id));
      for (const preset of d.presets!) {
        for (const [id, v] of Object.entries(preset.values)) {
          expect(ids.has(id), `${preset.name}: ${id}`).toBe(true);
          expect(v >= 0 && v <= 127, `${preset.name}: ${id}`).toBe(true);
        }
      }
      expect(new Set(d.presets!.map((p) => p.name)).size).toBe(d.presets!.length);
      expect(d.presets![0]!.values).toEqual({});
    });
  }

  it('fills the knobs a preset leaves out with their defaults', () => {
    const values = presetCcValues(def, { name: 'x', values: { cutoff: 10 } });
    expect(values[MONO_CC.cutoff]).toBe(10);
    expect(values[MONO_CC.resonance]).toBe(MONO_DEFAULTS.resonance);
    expect(Object.keys(values)).toHaveLength(def.params.length);
  });
});

describe('Drift Synth Mono: worklet', () => {
  const w = loadWorklet();

  it('registers its processor and accepts every parameter', () => {
    expect(w.registered).toBe(MONO_PROCESSOR);
    const e = new w.MonoEngine(SR);
    for (const [k, v] of monoDefaultValues()) expect(e.set(k, v), k).toBe(true);
    expect(e.set('nope', 1)).toBe(false);
    expect(e.set('cutoff', Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('keeps held notes in order: the newest plays, releasing it hands back to the one below', () => {
    const s = new w.NoteStack();
    s.push(36);
    s.push(43);
    s.push(48);
    expect(s.top()).toBe(48);
    s.remove(43);
    expect(s.top()).toBe(48);
    s.remove(48);
    expect(s.top()).toBe(36);
    s.push(36);
    expect(s.count).toBe(1);
    expect(s.remove(99)).toBe(false);
  });

  it('every preset is audible, finite and not too loud, and silent again after the release', () => {
    for (const preset of def.presets!) {
      const e = engine(w, presetCcValues(def, preset));
      e.noteOn(36, 0.8);
      const on = render(e, SR / 2);
      expect(on.every(Number.isFinite), preset.name).toBe(true);
      expect(peak(on), preset.name).toBeGreaterThan(0.05);
      expect(peak(on), preset.name).toBeLessThan(1.01);
      e.noteOff(36);
      render(e, SR * 5);
      expect(e.sounding, preset.name).toBe(false);
      expect(peak(render(e, 512)), preset.name).toBe(0);
    }
  });

  it('stays finite with extreme settings', () => {
    const all = Object.fromEntries(Object.values(MONO_CC).map((cc) => [cc, 127]));
    const e = engine(w, all);
    for (const n of [12, 24, 60, 96, 127]) e.noteOn(n, 1);
    const out = render(e, SR);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(peak(out)).toBeLessThan(1.01);
  });

  it('only overlapping notes glide; back-to-back notes jump', () => {
    const glide = { [MONO_CC.glide]: 110 };
    const legato = engine(w, glide);
    legato.noteOn(36, 0.8);
    render(legato, 4800);
    legato.noteOn(48, 0.8);
    render(legato, 4800);
    expect(legato.pitch).toBeGreaterThan(36.5);
    expect(legato.pitch).toBeLessThan(47.5);

    const detached = engine(w, glide);
    detached.noteOn(36, 0.8);
    render(detached, 4800);
    detached.noteOff(36);
    detached.noteOn(48, 0.8);
    expect(detached.pitch).toBe(48);
  });

  it('legato notes do not retrigger the envelopes; releasing the top note goes back to the held one', () => {
    const e = engine(w, { [MONO_CC.sustain]: 64, [MONO_CC.decay]: 0 });
    e.noteOn(36, 0.8);
    render(e, SR / 2);
    const settled = e.ampEnv;
    e.noteOn(43, 0.8);
    render(e, 64);
    expect(e.ampEnv).toBeCloseTo(settled, 2);
    e.noteOff(43);
    expect(e.target).toBe(36);
    expect(e.gate).toBe(true);
  });

  it('a pitch envelope starts the note higher and settles on it', () => {
    const e = engine(w, { [MONO_CC.pitchEnv]: 127, [MONO_CC.pitchDecay]: 60, [MONO_CC.osc2Level]: 0, [MONO_CC.sub]: 0, [MONO_CC.cutoff]: 127 });
    e.noteOn(36, 0.8);
    expect(e.pEnv).toBe(1);
    const start = crossings(render(e, 2400));
    render(e, SR / 2);
    expect(e.pEnv).toBeLessThan(0.001);
    const later = crossings(render(e, 2400));
    expect(start).toBeGreaterThan(later);
  });

  it('opens the filter further on accented notes', () => {
    const play = (vel: number) => {
      const e = engine(w, { [MONO_CC.accent]: 127 });
      e.noteOn(36, vel);
      return rms(render(e, 2400));
    };
    expect(play(110 / 127)).toBeGreaterThan(play(90 / 127) * 1.2);
  });

  it('at equal times a note off goes before a note on, so back-to-back notes retrigger', () => {
    const p = new w.MonoProcessor();
    for (const [k, v] of monoDefaultValues()) p.receive([WORKLET_MSG.param, k, v]);
    p.receive([WORKLET_MSG.param, 'glide', 0.5]);
    const now = 5;
    p.receive([WORKLET_MSG.noteOn, 36, 0.8, now]);
    const l = new Float32Array(128);
    p.run(l, l, 128, now);
    // Note on queued first, its off second, at the same time: still a fresh note.
    p.receive([WORKLET_MSG.noteOn, 48, 0.8, now + 200 / SR]);
    p.receive([WORKLET_MSG.noteOff, 36, 0, now + 200 / SR]);
    p.run(l, l, 128, now + 128 / SR);
    expect(p.engine.pitch).toBe(48);
  });

  it('starts a note on the exact frame of its AudioContext time', () => {
    const p = new w.MonoProcessor();
    for (const [k, v] of monoDefaultValues()) p.receive([WORKLET_MSG.param, k, v]);
    const now = 10;
    p.receive([WORKLET_MSG.noteOn, 36, 1, now + 77 / SR]);
    p.receive([WORKLET_MSG.noteOn, 40, 1, now + 1]); // later block: stays queued
    const l = new Float32Array(128);
    p.run(l, l, 128, now);
    expect(peak(l.subarray(0, 77))).toBe(0);
    expect(peak(l.subarray(78))).toBeGreaterThan(0);
    expect(p.qCount).toBe(1);
  });
});
