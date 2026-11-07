import { describe, expect, it } from 'vitest';
import hum from '../src/core/instruments/data/drift-synth-hum.json';
import { choiceLabel, choiceValue, type InstrumentDefinition } from '../src/core/instruments/instrument';
import { LOCAL_CC } from '../src/io/local/common';
import { HUM_CC, HUM_DEFAULTS, HUM_PROCESSOR, HUM_SYLLABLES, humDefaultValues, humParam, syllableBands } from '../src/io/local/hum/humParams';
import source from '../src/io/local/hum/humProcessor.js?raw';
import { LOCAL_PORTS } from '../src/io/local/ports';
import { BUILT_IN_INSTRUMENTS } from '../src/state/instrumentLibrary';
import { assignBestFit, newDevice, suggestInstrument, type Rack } from '../src/state/rack';
import { createProject, templateSounds } from '../src/state/templates';

const SR = 48000;
const def = hum as unknown as InstrumentDefinition;
const ccOf = (p: InstrumentDefinition['params'][number]) => (p.msg.type === 'cc' ? p.msg.cc : -1);
const CHANNEL_CCS: number[] = [LOCAL_CC.volume, LOCAL_CC.reverb, LOCAL_CC.delay];
const syllable = (name: (typeof HUM_SYLLABLES)[number]) => HUM_SYLLABLES.indexOf(name);

interface Worklet {
  HumEngine: new (sr: number) => any;
  HumProcessor: new () => any;
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
    `${source}\nreturn { HumEngine, HumProcessor, VoiceAllocator };`,
  )(class {}, register, SR) as Omit<Worklet, 'registered'>;
  return { ...exports, registered };
}

function engine(w: Worklet, overrides: Record<string, number> = {}) {
  const e = new w.HumEngine(SR);
  for (const [k, v] of humDefaultValues()) e.set(k, v);
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
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / Math.max(1, a.length));

/** Share of the energy above 1.6 kHz, from the harmonics of a steady 220 Hz note (Goertzel). */
function brightness(a: Float32Array, f0 = 220) {
  let high = 0;
  let all = 0;
  for (let h = 1; f0 * h < 5000; h++) {
    const c = 2 * Math.cos((2 * Math.PI * f0 * h) / SR);
    let s1 = 0;
    let s2 = 0;
    for (const x of a) {
      const s0 = x + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const power = s1 * s1 + s2 * s2 - c * s1 * s2;
    all += power;
    if (f0 * h > 1600) high += power;
  }
  return high / all;
}

/** A steady vowel: one note, no vibrato or drift, measured after the onset. */
function steady(w: Worklet, name: (typeof HUM_SYLLABLES)[number]) {
  const e = engine(w, { syllable: syllable(name), vibDepth: 0, humanize: 0, scoop: 0, breath: 0, ensemble: 0, attack: 0.005 });
  e.noteOn(57, 0.8);
  return render(e, SR / 2).l.subarray(SR / 4);
}

describe('Drift Synth Hum: definition and CC map', () => {
  it('is a built-in port and its definition is suggested for it', () => {
    expect(LOCAL_PORTS.hum).toBe('Drift Synth Hum');
    expect(suggestInstrument(LOCAL_PORTS.hum, BUILT_IN_INSTRUMENTS)?.id).toBe('drift-synth-hum');
  });

  it('every knob in the definition is handled, and every Hum CC has a knob with the same default', () => {
    for (const p of def.params) {
      const cc = ccOf(p);
      expect(CHANNEL_CCS.includes(cc) || humParam(cc, 64) !== undefined, `${p.name} (CC ${cc})`).toBe(true);
    }
    for (const [key, cc] of Object.entries(HUM_CC)) {
      const p = def.params.find((x) => ccOf(x) === cc);
      expect(p, key).toBeDefined();
      expect(p!.default, key).toBe(HUM_DEFAULTS[key as keyof typeof HUM_DEFAULTS]);
    }
    const ccs = def.params.map(ccOf);
    expect(new Set(ccs).size).toBe(ccs.length);
  });

  it('the syllable switch shows every syllable, and each choice sends that syllable', () => {
    const p = def.params.find((x) => x.id === 'syllable')!;
    expect(p.choices).toEqual(syllableBands());
    HUM_SYLLABLES.forEach((label, i) => {
      expect(choiceLabel(p, choiceValue(p, i))).toBe(label);
      expect(humParam(HUM_CC.syllable, choiceValue(p, i))![1]).toBe(i);
    });
    expect(humParam(HUM_CC.syllable, 127)![1]).toBe(HUM_SYLLABLES.length - 1);
  });

  it('has the syllables asked for: pa, doo, dee, pee and yay', () => {
    for (const s of ['Paa', 'Doo', 'Dee', 'Pee', 'Yay'] as const) expect(HUM_SYLLABLES).toContain(s);
  });

  it('reuses the shared CC numbers for brightness, resonance and the envelope', () => {
    expect(HUM_CC.brightness).toBe(LOCAL_CC.cutoff);
    expect(HUM_CC.focus).toBe(LOCAL_CC.resonance);
    expect(HUM_CC.attack).toBe(LOCAL_CC.attack);
    expect(HUM_CC.release).toBe(LOCAL_CC.release);
  });

  it('every preset names known knobs and in-range values', () => {
    const ids = new Set(def.params.map((p) => p.id));
    expect(def.presets!.length).toBeGreaterThanOrEqual(5);
    for (const preset of def.presets!) {
      for (const [k, v] of Object.entries(preset.values)) {
        expect(ids.has(k), `${preset.name}: ${k}`).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(127);
      }
    }
  });
});

describe('Drift Synth Hum: worklet', () => {
  const w = loadWorklet();

  it('registers its processor and accepts every parameter', () => {
    expect(w.registered).toBe(HUM_PROCESSOR);
    const e = new w.HumEngine(SR);
    for (const [k, v] of humDefaultValues()) expect(e.set(k, v), k).toBe(true);
    expect(e.set('nope', 1)).toBe(false);
    expect(e.set('voice', Number.NaN)).toBe(false);
  });

  it.each(HUM_SYLLABLES.map((s) => [s]))('sings %s: audible, finite, and silent again after the release', (name) => {
    const e = engine(w, { syllable: syllable(name) });
    e.noteOn(60, 0.8);
    const on = render(e, SR / 2);
    expect(rms(on.l)).toBeGreaterThan(0.02);
    expect(peak(on.l)).toBeLessThan(1);
    expect(on.l.every(Number.isFinite) && on.r.every(Number.isFinite)).toBe(true);
    e.noteOff(60);
    render(e, SR * 5);
    expect(Array.from(e.alloc.sounding).every((s) => s === 0)).toBe(true);
    expect(peak(render(e, 1024).l)).toBeLessThan(1e-4);
  });

  it('vowels sound different: "ee" is brighter than "aa", "aa" brighter than "ooh"', () => {
    const ee = brightness(steady(w, 'Dee'));
    const aa = brightness(steady(w, 'Aah'));
    const oo = brightness(steady(w, 'Ooh'));
    expect(ee).toBeGreaterThan(aa);
    expect(aa).toBeGreaterThan(oo);
  });

  it('keeps vowels at a similar loudness', () => {
    const levels = (['Aah', 'Dee', 'Ooh', 'Mmm'] as const).map((s) => rms(steady(w, s)));
    expect(Math.max(...levels) / Math.min(...levels)).toBeLessThan(3);
  });

  it('a "p" starts with a closure: near silence, then the burst and the vowel', () => {
    const e = engine(w, { syllable: syllable('Paa'), attack: 0.005, scoop: 0, articulation: 1 });
    e.noteOn(60, 0.8);
    const { l } = render(e, SR / 4);
    const ms = (a: number, b: number) => l.subarray(Math.round((a * SR) / 1000), Math.round((b * SR) / 1000));
    expect(rms(ms(4, 20))).toBeLessThan(rms(ms(120, 200)) * 0.25);
    expect(rms(ms(120, 200))).toBeGreaterThan(0.02);
  });

  it('"dum" closes on the m: the tail is darker than the vowel', () => {
    const e = engine(w, { syllable: syllable('Dum'), vibDepth: 0, humanize: 0, breath: 0, ensemble: 0, release: 1.5 });
    e.noteOn(57, 0.8);
    const vowel = render(e, SR / 2).l.subarray(SR / 4);
    e.noteOff(57);
    render(e, SR / 10);
    const tail = render(e, SR / 5).l;
    expect(brightness(tail)).toBeLessThan(brightness(vowel));
  });

  it('Cycle sings pa, doo, dee, pee, yay in turn; Scat and Random pick per note', () => {
    const e = engine(w, { syllable: syllable('Cycle') });
    const sung = [60, 62, 64, 65, 67, 69].map((n) => HUM_SYLLABLES[e.syl[e.noteOn(n, 0.8)]]);
    expect(sung).toEqual(['Paa', 'Doo', 'Dee', 'Pee', 'Yay', 'Paa']);
    for (const mode of ['Scat', 'Random'] as const) {
      const m = engine(w, { syllable: syllable(mode) });
      const picks = new Set<number>();
      for (let i = 0; i < 40; i++) {
        picks.add(m.syl[m.noteOn(48 + (i % 24), 0.8)]);
        m.allOff();
      }
      expect(picks.size, mode).toBeGreaterThan(2);
      for (const s of picks) expect(s).toBeLessThan(syllable('Scat'));
    }
  });

  it('chords with the choir are stereo and stay finite with extreme settings', () => {
    const e = engine(w, { ensemble: 1, voice: 1.28, focus: 0.5, breath: 1, articulation: 1, vibDepth: 0.8, scoop: 2, humanize: 1, syllable: syllable('Random') });
    for (const n of [24, 36, 48, 60, 72, 84, 96, 108]) e.noteOn(n, 1);
    const out = render(e, SR);
    expect(out.l.every(Number.isFinite) && out.r.every(Number.isFinite)).toBe(true);
    expect(peak(out.l)).toBeLessThan(4);
    expect(out.l.some((x, i) => Math.abs(x - out.r[i]!) > 1e-4)).toBe(true);
  });

  it('starts a note on the exact frame of its AudioContext time', () => {
    const p = new w.HumProcessor();
    for (const [k, v] of humDefaultValues()) p.receive([2, k, v]);
    p.receive([2, 'ensemble', 0]);
    p.receive([2, 'syllable', syllable('Aah')]);
    const now = 10;
    p.receive([0, 60, 1, now + 77 / SR]);
    p.receive([0, 64, 1, now + 1]);
    const l = new Float32Array(128);
    p.run(l, l, 128, now);
    expect(peak(l.subarray(0, 77))).toBe(0);
    expect(peak(l.subarray(80))).toBeGreaterThan(0);
    expect(p.qCount).toBe(1);
  });
});

describe('Drift Synth Hum in templates', () => {
  const fit = (id: string, rack: Rack) => assignBestFit(createProject(id), rack, BUILT_IN_INSTRUMENTS, templateSounds(id));
  const hw: Rack = { devices: [newDevice({ name: 'Hydrasynth', portName: 'Hydrasynth', roles: ['lead'], instrumentId: 'asm-hydrasynth' })] };

  it('the jazz ballad melody is sung (scat), with or without hardware', () => {
    for (const rack of [{ devices: [] }, hw]) {
      const melody = fit('jazz-ballad', rack).tracks.find((t) => t.name === 'Melody')!;
      expect(melody.instrumentId).toBe('drift-synth-hum');
      expect(melody.panel?.preset?.name).toBe('Scat');
    }
  });

  it.each([
    ['lofi', 'Melody', 'Lazy Doo'],
    ['ambient', 'Melody', 'Ooh Lead'],
    ['slow-drift', 'Air', 'Aah Choir'],
  ])('%s: %s gets the voice (%s) when no hardware plays it', (id, track, sound) => {
    const t = fit(id, { devices: [] }).tracks.find((x) => x.name === track)!;
    expect(t.instrumentId).toBe('drift-synth-hum');
    expect(t.panel?.preset?.name).toBe(sound);
  });
});
