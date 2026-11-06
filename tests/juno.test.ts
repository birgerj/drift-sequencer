import { describe, expect, it } from 'vitest';
import juno from '../src/core/instruments/data/drift-synth-juno.json';
import type { InstrumentDefinition } from '../src/core/instruments/instrument';
import { LOCAL_CC } from '../src/io/local/common';
import { JUNO_CC, JUNO_DEFAULTS, JUNO_MSG, JUNO_PROCESSOR, junoDefaultValues, junoParam } from '../src/io/local/juno/junoParams';
import source from '../src/io/local/juno/junoProcessor.js?raw';
import { LOCAL_PORTS } from '../src/io/local/localSynths';
import { BUILT_IN_INSTRUMENTS } from '../src/state/instrumentLibrary';
import { suggestInstrument } from '../src/state/rack';

const SR = 48000;
const def = juno as unknown as InstrumentDefinition;
const ccOf = (p: InstrumentDefinition['params'][number]) => (p.msg.type === 'cc' ? p.msg.cc : -1);
const CHANNEL_CCS: number[] = [LOCAL_CC.volume, LOCAL_CC.reverb, LOCAL_CC.delay];

interface Worklet {
  JunoEngine: new (sr: number) => any;
  JunoProcessor: new () => any;
  VoiceAllocator: new (n: number) => any;
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
    `${source}\nreturn { JunoEngine, JunoProcessor, VoiceAllocator };`,
  )(class {}, register, SR) as Omit<Worklet, 'registered'>;
  return { ...exports, registered };
}

function engineWithDefaults(w: Worklet, overrides: Record<string, number> = {}) {
  const e = new w.JunoEngine(SR);
  for (const [k, v] of junoDefaultValues()) e.set(k, v);
  for (const [k, v] of Object.entries(overrides)) e.set(k, v);
  return e;
}

function render(e: any, frames: number) {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  e.render(l, r, 0, frames);
  return { l, r };
}

const peak = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe('Drift Synth Juno: definition and CC map', () => {
  it('is a built-in port and its definition is suggested for it, not for the other Drift ports', () => {
    expect(LOCAL_PORTS.juno).toBe('Drift Synth Juno');
    expect(suggestInstrument(LOCAL_PORTS.juno, BUILT_IN_INSTRUMENTS)?.id).toBe('drift-synth-juno');
    expect(suggestInstrument(LOCAL_PORTS.lead, BUILT_IN_INSTRUMENTS)?.id).toBe('drift-synth-lead');
    expect(suggestInstrument(LOCAL_PORTS.pad, BUILT_IN_INSTRUMENTS)?.id).toBe('drift-synth-pad');
  });

  it('every knob in the definition is handled, and every Juno CC has a knob with the same default', () => {
    for (const p of def.params) {
      const cc = ccOf(p);
      expect(CHANNEL_CCS.includes(cc) || junoParam(cc, 64) !== undefined, `${p.name} (CC ${cc})`).toBe(true);
    }
    for (const [key, cc] of Object.entries(JUNO_CC)) {
      const p = def.params.find((x) => ccOf(x) === cc);
      expect(p, key).toBeDefined();
      expect(p!.default, key).toBe(JUNO_DEFAULTS[key as keyof typeof JUNO_DEFAULTS]);
    }
    const ccs = def.params.map(ccOf);
    expect(new Set(ccs).size).toBe(ccs.length);
  });

  it('reuses the shared CC numbers for the shared knobs', () => {
    expect(JUNO_CC.cutoff).toBe(LOCAL_CC.cutoff);
    expect(JUNO_CC.resonance).toBe(LOCAL_CC.resonance);
    expect(JUNO_CC.attack).toBe(LOCAL_CC.attack);
    expect(JUNO_CC.decay).toBe(LOCAL_CC.decay);
    expect(JUNO_CC.release).toBe(LOCAL_CC.release);
    expect(JUNO_CC.envMod).toBe(LOCAL_CC.envMod);
  });

  it('maps switches to their positions and knobs to real units', () => {
    expect([0, 42, 43, 85, 86, 127].map((v) => junoParam(JUNO_CC.range, v)![1])).toEqual([-1, -1, 0, 0, 1, 1]);
    expect([0, 31, 32, 63, 64, 95, 96, 127].map((v) => junoParam(JUNO_CC.chorus, v)![1])).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(junoParam(JUNO_CC.hpf, 0)![1]).toBe(0);
    expect(junoParam(JUNO_CC.cutoff, 0)![1]).toBeCloseTo(30);
    expect(junoParam(JUNO_CC.cutoff, 127)![1]).toBeCloseTo(18000);
    expect(junoParam(JUNO_CC.attack, 127)).toEqual(['attack', expect.closeTo(3)]);
    expect(junoParam(LOCAL_CC.waveform, 64)).toBeUndefined();
  });

});

describe('Drift Synth Juno: worklet', () => {
  const w = loadWorklet();

  it('registers its processor and accepts every parameter', () => {
    expect(w.registered).toBe(JUNO_PROCESSOR);
    const e = new w.JunoEngine(SR);
    for (const [k, v] of junoDefaultValues()) expect(e.set(k, v), k).toBe(true);
    expect(e.set('nope', 1)).toBe(false);
    expect(e.set('cutoff', Number.NaN)).toBe(false);
  });

  it('allocates six voices: same note reuses, free voices round-robin, then steals the oldest', () => {
    const a = new w.VoiceAllocator(6);
    const voices = [60, 62, 64, 65, 67, 69].map((n) => a.noteOn(n));
    expect(new Set(voices).size).toBe(6);
    expect(a.noteOn(60)).toBe(voices[0]); // retrigger
    a.noteOff(64);
    expect(a.noteOn(71)).toBe(voices[2]); // released voice before held ones
    expect(a.noteOn(72)).toBe(voices[1]); // oldest held note (62; 60 was retriggered)
    expect(a.noteOff(99)).toBe(-1);
  });

  it('prefers a silent voice over one still releasing', () => {
    const a = new w.VoiceAllocator(2);
    const v0 = a.noteOn(60);
    a.noteOff(60); // still sounding (release)
    const v1 = a.noteOn(62);
    expect(v1).not.toBe(v0);
    a.noteOff(62);
    a.sounding[v1] = 0; // its release finished
    expect(a.noteOn(64)).toBe(v1);
  });

  it('plays with its defaults: audible, finite, stereo, and silent again after the release', () => {
    const e = engineWithDefaults(w);
    for (const n of [48, 55, 60, 64, 67, 72]) e.noteOn(n, 0.8);
    const on = render(e, SR / 2);
    expect(peak(on.l)).toBeGreaterThan(0.05);
    expect(peak(on.l)).toBeLessThan(1.5);
    expect(on.l.every(Number.isFinite)).toBe(true);
    expect(on.l.some((x, i) => Math.abs(x - on.r[i]!) > 1e-4)).toBe(true); // chorus I is stereo
    e.allOff();
    render(e, SR * 3);
    expect(Array.from(e.alloc.sounding).every((s) => s === 0)).toBe(true);
    expect(peak(render(e, 1024).l)).toBeLessThan(1e-4);
  });

  it('stays finite with extreme settings', () => {
    const e = engineWithDefaults(w, { resonance: 4.1, cutoff: 18000, envMod: 7, noise: 1, sub: 1, pulse: 1, range: 1, hpf: 1500, chorus: 3, dcoLfo: 4, vcfLfo: 3 });
    for (const n of [24, 36, 96, 108, 120, 127]) e.noteOn(n, 1);
    const out = render(e, SR);
    expect(out.l.every(Number.isFinite) && out.r.every(Number.isFinite)).toBe(true);
    expect(peak(out.l)).toBeLessThan(4);
  });

  it('starts a note on the exact frame of its AudioContext time', () => {
    const p = new w.JunoProcessor();
    for (const [k, v] of junoDefaultValues()) p.receive([JUNO_MSG.param, k, v]);
    p.receive([JUNO_MSG.param, 'chorus', 0]);
    p.receive([JUNO_MSG.param, 'attack', 0.0015]);
    const now = 10;
    p.receive([JUNO_MSG.noteOn, 60, 1, now + 77 / SR]);
    p.receive([JUNO_MSG.noteOn, 64, 1, now + 1]); // later block: stays queued
    const l = new Float32Array(128);
    p.run(l, l, 128, now);
    expect(peak(l.subarray(0, 77))).toBe(0);
    expect(peak(l.subarray(78))).toBeGreaterThan(0);
    expect(p.qCount).toBe(1);
  });
});
