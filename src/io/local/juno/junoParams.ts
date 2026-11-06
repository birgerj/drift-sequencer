import { expRange, LOCAL_CC, norm } from '../common';

/**
 * Drift Synth Juno: the panel of a Juno-60-style polysynth as CCs.
 * Shared knobs reuse the LOCAL_CC numbers (cutoff, resonance, envelope);
 * the rest use free/undefined controllers. Mirrored in
 * `core/instruments/data/drift-synth-juno.json` (a test keeps them in step).
 *
 * Volume (CC 7, shown as "VCA level"), reverb and delay sends are handled
 * by the shared channel, like the other Drift Synth sounds.
 */
export const JUNO_CC = {
  lfoRate: 76,
  lfoDelay: 78,
  range: 20,
  dcoLfo: 77,
  pwm: 21,
  pwmSource: 22,
  pulse: 23,
  saw: 24,
  sub: 25,
  noise: 26,
  hpf: 27,
  cutoff: LOCAL_CC.cutoff,
  resonance: LOCAL_CC.resonance,
  envMod: LOCAL_CC.envMod,
  vcfLfo: 28,
  keyFollow: 29,
  attack: LOCAL_CC.attack,
  decay: LOCAL_CC.decay,
  sustain: 79,
  release: LOCAL_CC.release,
  chorus: 93,
} as const;

export type JunoParam = keyof typeof JUNO_CC;

/** Name of the AudioWorkletProcessor in junoProcessor.js. */
export const JUNO_PROCESSOR = 'drift-juno';

/** Messages to the worklet: [type, a, b, time]. Mirrored in junoProcessor.js. */
export const JUNO_MSG = { noteOn: 0, noteOff: 1, param: 2, allOff: 3 } as const;

const steps = (v: number, n: number) => Math.min(n - 1, Math.floor((Math.max(0, Math.min(127, v)) * n) / 128));

/** CC value (0–127) → the engine's value in real units. */
const MAP: Record<JunoParam, (v: number) => number> = {
  lfoRate: (v) => expRange(v, 0.1, 20), // Hz
  lfoDelay: (v) => norm(v) * norm(v) * 3, // s until the LFO is fully in
  range: (v) => steps(v, 3) - 1, // octaves: 16' / 8' / 4'
  dcoLfo: (v) => norm(v) * norm(v) * 4, // semitones of vibrato
  pwm: (v) => norm(v) * 0.45, // how far the pulse narrows from square
  pwmSource: (v) => steps(v, 3), // 0 LFO, 1 manual, 2 envelope
  pulse: norm,
  saw: norm,
  sub: norm,
  noise: norm,
  hpf: (v) => (v < 4 ? 0 : expRange(v, 20, 1500)), // Hz, 0 = off
  cutoff: (v) => expRange(v, 30, 18000), // Hz
  resonance: (v) => norm(v) * 4.1, // ladder feedback; ~4 self-oscillates
  envMod: (v) => norm(v) * 7, // octaves
  vcfLfo: (v) => norm(v) * norm(v) * 3, // octaves
  keyFollow: norm, // 1 = the filter follows the keyboard fully
  attack: (v) => expRange(v, 0.0015, 3), // s
  decay: (v) => expRange(v, 0.005, 12), // s
  sustain: norm,
  release: (v) => expRange(v, 0.005, 12), // s
  chorus: (v) => steps(v, 4), // 0 off, 1 I, 2 II, 3 I+II
};

/**
 * Default panel: a warm saw + PWM string sound with chorus I. Short enough
 * to play lines, soft enough to hold chords.
 */
export const JUNO_DEFAULTS: Record<JunoParam, number> = {
  lfoRate: 52,
  lfoDelay: 30,
  range: 64,
  dcoLfo: 0,
  pwm: 70,
  pwmSource: 0,
  pulse: 60,
  saw: 110,
  sub: 40,
  noise: 0,
  hpf: 0,
  cutoff: 80,
  resonance: 20,
  envMod: 40,
  vcfLfo: 0,
  keyFollow: 64,
  attack: 35,
  decay: 85,
  sustain: 85,
  release: 82,
  chorus: 40,
};

const BY_CC = new Map<number, JunoParam>(Object.entries(JUNO_CC).map(([k, cc]) => [cc, k as JunoParam]));

/** The engine parameter a CC sets, with its value in real units; undefined if the Juno ignores it. */
export function junoParam(cc: number, value: number): [JunoParam, number] | undefined {
  const key = BY_CC.get(cc);
  return key ? [key, MAP[key](value)] : undefined;
}

/** All parameters at their default, in engine units. */
export function junoDefaultValues(): [JunoParam, number][] {
  return (Object.keys(JUNO_DEFAULTS) as JunoParam[]).map((k) => [k, MAP[k](JUNO_DEFAULTS[k])]);
}
